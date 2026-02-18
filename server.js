const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').RedisStore;
const dotenv = require('dotenv');
dotenv.config();

// 0. Secure Startup Validation (CRASH if unsafe)
// Run this BEFORE other imports to catch missing secrets early
require('./src/utils/envValidator')();

const { logger, auditLogger } = require('./src/config/logger');
const redisClient = require('./src/config/redis');
const { helmetMiddleware, corsMiddleware, rateLimitMiddleware, sanitizeInput } = require('./src/middleware/security');
const { enforceLanguage } = require('./src/middleware/languageEnforcement');
const abuseProtection = require('./src/middleware/abuseProtection');
const phiRedaction = require('./src/middleware/phiRedaction');
const checkConsent = require('./src/middleware/consentEnforcement');
const requestIdMiddleware = require('./src/middleware/requestId');
const requireAdmin = require('./src/middleware/rbac');

// Services
const triageService = require('./src/services/triageService');
const aiService = require('./src/services/aiService');
const bookingService = require('./src/services/bookingService');

const HumanHandoffService = require('./src/services/humanHandoffService');
const healthRoutes = require('./src/routes/health');
const hospitalRouter = require('./src/routes/hospitalRouter');
const { getSafeAIInput } = require('./src/utils/safeAIInput');

// Workers (Phase 5)
const startSMSWorker = require('./src/workers/smsWorker');
const startEmailWorker = require('./src/workers/emailWorker');

// Start workers
startSMSWorker();
startEmailWorker();

// Note: resolveHospitalContext is now applied via hospitalRouter




const app = express();
const PORT = process.env.PORT || 3000;

// 1. Traceability & Correlation ID (First Middleware)
app.use(requestIdMiddleware);

// 1. Security Middleware
app.use(helmetMiddleware);
app.set('trust proxy', 1); // Trust first proxy (required for rate limit/session behind Nginx/load balancer)
app.use(corsMiddleware);
app.use(express.json({ limit: '10kb' })); // Body limit against DOS
app.use(sanitizeInput);

// 2. Session Management (Redis)
// Phase 8: 30-minute idle timeout with rolling refresh
app.use(session({
  store: new RedisStore({
    client: redisClient,
    prefix: 'hospital-ai:sess:',
  }),
  secret: process.env.SESSION_SECRET, // Validation ensures this is set
  resave: false,
  saveUninitialized: false, // Privacy: don't save empty sessions
  rolling: true, // Reset expiry on activity (Phase 8)
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
    httpOnly: true, // Prevent XSS access
    maxAge: 30 * 60 * 1000, // 30 minutes (Phase 8)
    sameSite: 'strict'
  }
}));

// 3. Public Assets
app.use(express.static('public'));

// 4. API Routes
app.use('/health', healthRoutes); // Unprotected health check (or add basic auth if needed)

// Admin Protected Route (Logs)
app.get('/admin/logs', requireAdmin, (req, res) => {
  res.json({ message: 'Admin Logs Access Granted', id: req.id });
});



// ============================================================
// LEGACY ROUTE (DEPRECATED - Will be removed in Phase 3)
// Kept for backward compatibility during transition
// SECURITY NOTE: This still needs resolveHospitalContext for old clients
// ============================================================
const { resolveHospitalContext } = require('./src/middleware/hospitalContext');
app.post('/chat', rateLimitMiddleware, abuseProtection, async (req, res, next) => {
  // Set default hospital for legacy route
  req.params.hospital_id = 'default';
  // Initialize hospital session isolation for legacy route
  const hospitalId = 'default';
  if (!req.session.hospitals) req.session.hospitals = {};
  if (!req.session.hospitals[hospitalId]) {
    req.session.hospitals[hospitalId] = {
      history: [], preferredLanguage: null, consentGiven: false,
      pendingBooking: null, consecutiveErrors: 0
    };
  }
  req.hospitalSession = req.session.hospitals[hospitalId];
  res.locals.hospitalSession = req.hospitalSession;
  next();
}, resolveHospitalContext, phiRedaction, enforceLanguage, checkConsent, async (req, res) => {
  try {
    // req.body.message is now REDACTED. req.local.rawMessage is RAW.
    const message = req.body.message;
    // REQUIREMENT: Use res.locals (formerly req.local)
    const rawMessage = res.locals.rawMessage || message;

    // Get hospital context (MULTI-TENANT ISOLATION)
    const hospitalId = res.locals.hospitalId;
    const hospital = res.locals.hospital;

    // AUDIT 1: Message Received (Redacted, with hospital_id)
    auditLogger.info({
      action: 'MESSAGE_RECEIVED',
      hospital_id: hospitalId,
      conversationId: req.sessionID,
      actor: 'user',
      data: {
        message_redacted: message.substring(0, 100) + (message.length > 100 ? '...' : '')
      }
    });

    if (!message || typeof message !== 'string' || message.length > 500) {
      return res.status(400).json({ error: 'Invalid message format.' });
    }

    const session = req.session;
    if (!session.history) session.history = [];

    // --- CRITICAL: AI DISENGAGEMENT CHECK ---
    // If session has been escalated, AI MUST NOT be called
    // This is a HARD RULE for PHI safety and user experience
    if (HumanHandoffService.isEscalated(session)) {
      // AUDIT: Log that post-escalation message was received
      auditLogger.info({
        action: 'POST_ESCALATION_MESSAGE',
        hospital_id: hospitalId,
        conversationId: req.sessionID,
        actor: 'user',
        data: { note: 'User message received after escalation, AI not invoked' }
      });

      // Return static response - AI is NOT called
      return res.json(HumanHandoffService.getEscalatedResponse());
    }

    // --- STEP 1: HYBRID TRIAGE (Use RAW message for safety) ---
    const triageResult = triageService.evaluate(rawMessage);

    // AUDIT 2: Triage Result (with hospital_id)
    auditLogger.info({
      action: 'TRIAGE_RESULT',
      hospital_id: hospitalId,
      conversationId: req.sessionID,
      actor: 'system',
      data: { status: triageResult.status, department: triageResult.department || 'none' }
    });

    // Emergency Bypass
    if (triageResult.status === 'emergency') {
      logger.warn(`Emergency bypass triggered for session ${req.sessionID}`);
      return res.json({ reply: triageResult.response });
    }

    // --- STEP 2: CONTEXT PREP (Hospital-aware) ---
    let contextData = {
      hospital: hospital,
      hospitalId: hospitalId,
      workingHours: hospital.working_hours || null
    };
    if (triageResult.department) {
      // Only process if department is valid for this hospital
      if (hospital.departments.includes(triageResult.department)) {
        logger.info(`Context: Fetched slots for ${triageResult.department} at ${hospital.name}`);
        const slots = await bookingService.getAvailableSlots(triageResult.department, hospitalId);
        contextData.availableSlots = slots.map(s => `${s.start_time} with ${s.doctor_name}`).join('\n');
      } else {
        logger.warn(`Department ${triageResult.department} not available at ${hospital.name}`);
        contextData.availableSlots = null;
      }
    }

    // --- STEP 3: HUMAN ESCALATION CHECK (Hospital-aware, Bilingual) ---
    // Detects both English and Arabic handoff keywords
    if (HumanHandoffService.isHandoffRequested(rawMessage)) {
      const handoffResponse = await HumanHandoffService.triggerHandoff(
        req.sessionID,
        'User Keyword Request',
        hospital,
        session, // Pass session to set escalatedAt flag
        HumanHandoffService.TRIGGER_TYPES.USER_REQUESTED
      );
      session.history.push({ role: 'user', content: message });
      session.history.push({ role: 'assistant', content: handoffResponse.reply });
      return res.json(handoffResponse);
    }

    // --- STEP 4: AI EXECUTION (PHI Safety Boundary) ---
    // Store context data for getSafeAIInput
    req._aiContext = contextData;

    // Get safe AI input (ONLY redacted content)
    const safeInput = getSafeAIInput(req);

    // AIService now only accepts SafeAIInput instances
    const aiResponse = await aiService.generateResponse(safeInput);

    // AUDIT 3: AI Response (with hospital_id)
    auditLogger.info({
      action: 'AI_RESPONSE',
      hospital_id: hospitalId,
      conversationId: req.sessionID,
      actor: 'ai_assistant',
      data: {
        reply_length: aiResponse.reply.length
      }
    });

    // Update History (Store REDACTED user message)
    session.history.push({ role: 'user', content: message });
    session.history.push({ role: 'assistant', content: aiResponse.reply });

    // --- STEP 4: BOOKING HANDLING & OTP ---
    if (session.pendingBooking) {
      // Check if message looks like OTP (6 digits)
      // REQUIREMENT: Use RAW input for OTP
      const otpCode = rawMessage.trim();
      if (/^\d{6}$/.test(otpCode)) {
        const isValid = await require('./src/services/otpService').verifyOtp(session.id, otpCode);
        if (isValid) {
          const { name, phone, department, date, time } = session.pendingBooking;
          const exactSlot = await bookingService.findSlotByTime(department, date, time);

          if (exactSlot) {
            await bookingService.confirmBooking(exactSlot.id, name, phone);
            logger.info(`Booking Confirmed via OTP: ID ${exactSlot.id}`);
            delete session.pendingBooking; // Clear pending state
            return res.json({ reply: "✅ Booking Confirmed! We look forward to seeing you." });
          } else {
            delete session.pendingBooking;
            return res.json({ reply: "⚠️ The slot is no longer available. Please choose another time." });
          }
        } else {
          return res.json({ reply: "❌ Invalid code. Please try again." });
        }
      }
    }

    if (aiResponse.bookingData) {
      const { name, phone, department, date, time } = aiResponse.bookingData;

      // Re-verify availability
      const exactSlot = await bookingService.findSlotByTime(department, date, time);

      if (exactSlot) {
        // INSTEAD OF CONFIRMING, INITIATE OTP
        const otp = await require('./src/services/otpService').generateOtp(session.id);

        // Store in session
        session.pendingBooking = aiResponse.bookingData;

        // Send OTP Email (Async)
        const { emailQueue } = require('./src/config/queue');
        emailQueue.add('send-otp', {
          details: { ...aiResponse.bookingData, otp }
        });

        // Reply to user
        res.json({ reply: `${aiResponse.reply}\n\n🔒 **Security Check**: I have sent a 6-digit verification code to the hospital admin (simulation). Please type the code here to finalize your booking.` });
        return;
      } else {
        logger.warn(`Booking Mismatch: AI proposed ${date} ${time} but slot invalid/taken.`);
      }
    }
    // --- STEP 5: AUTO-HANDOFF CHECK ---
    // Uses configurable threshold from hospital escalation_config
    if (aiResponse.status === 'error') {
      session.consecutiveErrors = (session.consecutiveErrors || 0) + 1;
      logger.warn(`AI Failure Detected. Consecutive Errors: ${session.consecutiveErrors}`);

      // Check if auto-escalation should trigger (uses hospital-specific threshold)
      const autoTrigger = HumanHandoffService.checkAutoTrigger(session, aiResponse, hospital);

      if (autoTrigger.shouldEscalate) {
        logger.warn(`Auto-Handoff Triggered for Session ${req.sessionID}, reason: ${autoTrigger.triggerType}`);
        const handoffResponse = await HumanHandoffService.triggerHandoff(
          req.sessionID,
          'Automatic Escalation',
          hospital,
          session, // Pass session to set escalatedAt flag
          autoTrigger.triggerType
        );
        session.consecutiveErrors = 0; // Reset after handoff

        session.history.push({ role: 'user', content: message });
        session.history.push({ role: 'assistant', content: handoffResponse.reply });

        return res.json(handoffResponse);
      }
    } else {
      // Reset on success
      session.consecutiveErrors = 0;
    }

    res.json({ reply: aiResponse.reply });

  } catch (error) {
    logger.error('Server Error in /chat', error);
    res.status(500).json({ error: 'Internal system error.' });
  }
});


// ============================================================
// PHASE 2: Hospital-Scoped Routes (NEW)
// All hospital-specific routes use /:hospital_id prefix
// ============================================================
app.use('/:hospital_id', hospitalRouter);

// Email Service (Modularized)
const { transporter } = require('./src/config/email');


async function sendBookingEmail(details) {
  if (!process.env.EMAIL_USER) return;
  const recipient = process.env.BUSINESS_EMAIL || process.env.EMAIL_USER;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: recipient,
    subject: `New Appointment: ${details.name}`,
    text: `Name: ${details.name}\nDepartment: ${details.department}\nTime: ${details.date} ${details.time}`
  });
}

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled Exception', err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// ============================================================
// SERVER STARTUP - Phase 7 Hardening
// ============================================================

const { registerResources, installShutdownHandlers } = require('./src/utils/gracefulShutdown');
const { enforceRetentionSafe } = require('./src/services/retentionService');
const { initializeDatabase } = require('./src/config/productionDb');
// redisClient already imported at top level

const server = require('http').createServer(app);

// Only listen if run directly
if (require.main === module) {
  server.listen(PORT, async () => {
    logger.info(`Production Server running on port ${PORT}`);

    // Install graceful shutdown handlers
    installShutdownHandlers();

    // Register resources for graceful shutdown
    registerResources({
      server,
      redis: redisClient
    });

    // Run retention enforcement on startup (non-blocking)
    try {
      const db = await initializeDatabase();
      registerResources({ database: db });

      // Schedule retention check daily
      setInterval(async () => {
        try {
          await enforceRetentionSafe(db);
        } catch (err) {
          logger.error('Scheduled retention failed:', err);
        }
      }, 24 * 60 * 60 * 1000); // Daily

      logger.info('Retention policy scheduled (daily)');

      // Run initial retention check after short delay
      setTimeout(async () => {
        try {
          await enforceRetentionSafe(db);
        } catch (err) {
          logger.warn('Initial retention check skipped:', err.message);
        }
      }, 5000);

    } catch (err) {
      logger.warn('Retention scheduling skipped:', err.message);
    }
  });
}

module.exports = { app, server, redisClient };

