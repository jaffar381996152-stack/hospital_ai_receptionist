/**
 * Hospital Router - Phase 2
 * 
 * All routes under /:hospital_id are handled here.
 * Hospital context is resolved before any route handlers execute.
 * 
 * Route structure:
 *   /:hospital_id/chat     - Chat endpoint
 *   /:hospital_id/book     - Direct booking
 *   /:hospital_id/api/*    - API endpoints
 *   /:hospital_id/reception - Reception dashboard
 */

const express = require('express');
const path = require('path');
const router = express.Router({ mergeParams: true }); // mergeParams to access :hospital_id

const { resolveHospitalContext, enforceHospitalIsolation } = require('../middleware/hospitalContext');
const { rateLimitMiddleware, sanitizeInput } = require('../middleware/security');
const { enforceLanguage } = require('../middleware/languageEnforcement');
const abuseProtection = require('../middleware/abuseProtection');
const phiRedaction = require('../middleware/phiRedaction');
const checkConsent = require('../middleware/consentEnforcement');
const { logger, auditLogger } = require('../config/logger');

// Services
const triageService = require('../services/triageService');
const aiService = require('../services/aiService');
const bookingService = require('../services/bookingService');
const HumanHandoffService = require('../services/humanHandoffService');
const { getSafeAIInput } = require('../utils/safeAIInput');

// Sub-routers (Phase 6)
const receptionRouter = require('./receptionRouter');

// Apply hospital context resolution to ALL routes in this router
router.use(resolveHospitalContext);
router.use(enforceHospitalIsolation);

/**
 * Hospital Session Isolation Middleware
 * 
 * Namespaces ALL session data under session.hospitals[hospitalId].
 * This ensures Hospital A's conversation/consent/language state
 * is completely isolated from Hospital B, even in the same browser.
 * 
 * Exposes req.hospitalSession as a convenience accessor.
 */
router.use((req, res, next) => {
    const hospitalId = req.hospitalId;
    if (!hospitalId) return next();

    // Initialize hospital namespace in session
    if (!req.session.hospitals) {
        req.session.hospitals = {};
    }
    if (!req.session.hospitals[hospitalId]) {
        req.session.hospitals[hospitalId] = {
            history: [],
            preferredLanguage: null,
            consentGiven: false,
            pendingBooking: null,
            consecutiveErrors: 0
        };
    }

    // Expose as convenience accessor
    req.hospitalSession = req.session.hospitals[hospitalId];

    // Also set on res.locals for middleware compatibility
    res.locals.hospitalSession = req.hospitalSession;

    next();
});


// Mount reception API router
router.use('/api/reception', receptionRouter);

// Serve reception dashboard pages
router.get('/reception', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/reception.html'));
});

router.get('/reception/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/reception-dashboard.html'));
});

// UI Routes for Hospital Chat
// Serve the main index.html for hospital root and chat paths
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

router.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

/**
 * POST /:hospital_id/set-language
 * 
 * Dedicated endpoint for language selection via buttons.
 * Bypasses the full chat middleware chain (phiRedaction, enforceLanguage, checkConsent).
 */
router.post('/set-language', (req, res) => {
    const { language } = req.body;
    const hospital = req.hospital;
    const hospitalId = req.hospitalId;

    const supportedLanguages = ['English', 'Arabic', 'Roman Arabic'];

    if (!language || !supportedLanguages.includes(language)) {
        return res.status(400).json({
            error: 'Invalid language',
            supported: supportedLanguages
        });
    }

    // Set language in hospital-scoped session
    req.hospitalSession.preferredLanguage = language;

    logger.info(`Language set via button: ${language} for hospital ${hospitalId}`);

    auditLogger.info({
        action: 'LANGUAGE_SET',
        hospital_id: hospitalId,
        conversationId: req.sessionID,
        actor: 'user',
        data: { language, method: 'button' }
    });

    // Return success with localized confirmation
    let message;
    if (language === 'Arabic') {
        message = 'تم تعيين اللغة العربية';
    } else if (language === 'Roman Arabic') {
        message = 'Language set to Arabizi';
    } else {
        message = 'Language set to English';
    }

    res.json({
        success: true,
        language,
        message,
        needsConsent: !req.hospitalSession.consentGiven
    });
});

/**
 * POST /:hospital_id/set-consent
 * 
 * Dedicated endpoint for consent via buttons (Yes/No).
 * Bypasses the full chat middleware chain.
 */
router.post('/set-consent', (req, res) => {
    const { consent } = req.body;
    const hospital = req.hospital;
    const hospitalId = req.hospitalId;
    const lang = req.hospitalSession.preferredLanguage || 'English';

    if (typeof consent !== 'boolean') {
        return res.status(400).json({ error: 'consent must be true or false' });
    }

    auditLogger.info({
        action: consent ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
        hospital_id: hospitalId,
        conversationId: req.sessionID,
        actor: 'user',
        data: { consent, method: 'button' }
    });

    if (!consent) {
        logger.info(`Consent denied via button for hospital ${hospitalId}`);
        let denyMsg;
        if (lang === 'Arabic') {
            denyMsg = 'تم رفض الوصول. لأسباب قانونية وأمنية، يجب الموافقة على إخلاء المسؤولية لاستخدام هذه الخدمة.';
        } else {
            denyMsg = 'Access denied. For legal and safety reasons, you must agree to the disclaimer to use this service. Please press Yes to proceed or call the hospital for manual assistance.';
        }
        return res.json({
            success: false,
            consentGiven: false,
            message: denyMsg
        });
    }

    // Grant consent
    req.hospitalSession.consentGiven = true;
    logger.info(`Consent granted via button for hospital ${hospitalId}`);

    // Return welcome message based on language
    let welcomeMsg;
    if (lang === 'Arabic') {
        welcomeMsg = `شكراً لك. أنا موظف استقبال ${hospital.name} (AI). كيف يمكنني مساعدتك اليوم؟ (يمكنك السؤال عن المواعيد، الأقسام، أو معلومات عامة).`;
    } else if (lang === 'Roman Arabic') {
        welcomeMsg = `Shukran. Ana muwazaf istiqbal ${hospital.name} (AI). Kif agdar asa3dak alyaum? (Tigdar tas'al 3an maw3id, aqsam, aw ma3lumat 3amah).`;
    } else {
        welcomeMsg = `Thank you. I am the ${hospital.name} AI Receptionist. How can I help you today? (You can ask about appointments, departments, or general information).`;
    }

    res.json({
        success: true,
        consentGiven: true,
        message: welcomeMsg
    });
});

/**
 * GET /:hospital_id/session-status
 * 
 * Returns current session state for this hospital.
 * Used by frontend to restore UI state on page reload.
 */
router.get('/session-status', (req, res) => {
    const hs = req.hospitalSession;
    res.json({
        language: hs.preferredLanguage || null,
        consentGiven: hs.consentGiven || false,
        hasHistory: (hs.history && hs.history.length > 0) || false
    });
});


/**
 * POST /:hospital_id/chat
 * 
 * Main chat endpoint - handles AI conversation flow
 */
router.post('/chat',
    rateLimitMiddleware,
    abuseProtection,
    phiRedaction,
    enforceLanguage,
    checkConsent,
    async (req, res) => {
        try {
            // req.body.message is now REDACTED. req.local.rawMessage is RAW.
            const message = req.body.message;
            const rawMessage = res.locals.rawMessage || message;

            // Get hospital context (MULTI-TENANT ISOLATION)
            // Now uses req.hospital (from URL) instead of res.locals
            const hospitalId = req.hospitalId;
            const hospital = req.hospital;

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

            // Use hospital-scoped session
            const hospitalSession = req.hospitalSession;
            if (!hospitalSession.history) hospitalSession.history = [];

            // --- CRITICAL: AI DISENGAGEMENT CHECK ---
            if (HumanHandoffService.isEscalated(hospitalSession)) {
                auditLogger.info({
                    action: 'POST_ESCALATION_MESSAGE',
                    hospital_id: hospitalId,
                    conversationId: req.sessionID,
                    actor: 'user',
                    data: { note: 'User message received after escalation, AI not invoked' }
                });

                return res.json(HumanHandoffService.getEscalatedResponse());
            }

            // --- STEP 1: HYBRID TRIAGE (Use RAW message for safety) ---
            const triageResult = triageService.evaluate(rawMessage);

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
                if (hospital.departments && hospital.departments.includes(triageResult.department)) {
                    logger.info(`Context: Fetched slots for ${triageResult.department} at ${hospital.name}`);
                    const slots = await bookingService.getAvailableSlots(triageResult.department, hospitalId);
                    contextData.availableSlots = slots.map(s => `${s.start_time} with ${s.doctor_name}`).join('\n');
                } else {
                    logger.warn(`Department ${triageResult.department} not available at ${hospital.name}`);
                    contextData.availableSlots = null;
                }
            }

            // --- STEP 3: HUMAN ESCALATION CHECK ---
            if (HumanHandoffService.isHandoffRequested(rawMessage)) {
                const handoffResponse = await HumanHandoffService.triggerHandoff(
                    req.sessionID,
                    'User Keyword Request',
                    hospital,
                    hospitalSession,
                    HumanHandoffService.TRIGGER_TYPES.USER_REQUESTED
                );
                hospitalSession.history.push({ role: 'user', content: message });
                hospitalSession.history.push({ role: 'assistant', content: handoffResponse.reply });
                return res.json(handoffResponse);
            }

            // --- STEP 4: AI EXECUTION ---
            req._aiContext = contextData;
            const safeInput = getSafeAIInput(req);
            const aiResponse = await aiService.generateResponse(safeInput);

            auditLogger.info({
                action: 'AI_RESPONSE',
                hospital_id: hospitalId,
                conversationId: req.sessionID,
                actor: 'ai_assistant',
                data: { reply_length: aiResponse.reply.length }
            });

            hospitalSession.history.push({ role: 'user', content: message });
            hospitalSession.history.push({ role: 'assistant', content: aiResponse.reply });

            // --- STEP 5: BOOKING HANDLING & OTP ---
            if (hospitalSession.pendingBooking) {
                const otpCode = rawMessage.trim();
                if (/^\d{6}$/.test(otpCode)) {
                    const isValid = await require('../services/otpService').verifyOtp(req.sessionID, otpCode);
                    if (isValid) {
                        const { name, phone, department, date, time } = hospitalSession.pendingBooking;
                        const exactSlot = await bookingService.findSlotByTime(department, date, time);

                        if (exactSlot) {
                            await bookingService.confirmBooking(exactSlot.id, name, phone);
                            logger.info(`Booking Confirmed via OTP: ID ${exactSlot.id}`);
                            hospitalSession.pendingBooking = null;
                            return res.json({ reply: "✅ Booking Confirmed! We look forward to seeing you." });
                        } else {
                            hospitalSession.pendingBooking = null;
                            return res.json({ reply: "⚠️ The slot is no longer available. Please choose another time." });
                        }
                    } else {
                        return res.json({ reply: "❌ Invalid code. Please try again." });
                    }
                }
            }

            if (aiResponse.bookingData) {
                const { name, phone, department, date, time } = aiResponse.bookingData;
                const exactSlot = await bookingService.findSlotByTime(department, date, time);

                if (exactSlot) {
                    const otp = await require('../services/otpService').generateOtp(req.sessionID);
                    hospitalSession.pendingBooking = aiResponse.bookingData;

                    const { emailQueue } = require('../config/queue');
                    emailQueue.add('send-otp', {
                        details: { ...aiResponse.bookingData, otp }
                    });

                    res.json({ reply: `${aiResponse.reply}\n\n🔒 **Security Check**: I have sent a 6-digit verification code to the hospital admin (simulation). Please type the code here to finalize your booking.` });
                    return;
                } else {
                    logger.warn(`Booking Mismatch: AI proposed ${date} ${time} but slot invalid/taken.`);
                }
            }

            // --- STEP 6: AUTO-HANDOFF CHECK ---
            if (aiResponse.status === 'error') {
                hospitalSession.consecutiveErrors = (hospitalSession.consecutiveErrors || 0) + 1;
                logger.warn(`AI Failure Detected. Consecutive Errors: ${hospitalSession.consecutiveErrors}`);

                const autoTrigger = HumanHandoffService.checkAutoTrigger(hospitalSession, aiResponse, hospital);

                if (autoTrigger.shouldEscalate) {
                    logger.warn(`Auto-Handoff Triggered for Session ${req.sessionID}, reason: ${autoTrigger.triggerType}`);
                    const handoffResponse = await HumanHandoffService.triggerHandoff(
                        req.sessionID,
                        'Automatic Escalation',
                        hospital,
                        hospitalSession,
                        autoTrigger.triggerType
                    );
                    hospitalSession.consecutiveErrors = 0;

                    hospitalSession.history.push({ role: 'user', content: message });
                    hospitalSession.history.push({ role: 'assistant', content: handoffResponse.reply });

                    return res.json(handoffResponse);
                }
            } else {
                hospitalSession.consecutiveErrors = 0;
            }

            res.json({ reply: aiResponse.reply });

        } catch (error) {
            logger.error('Server Error in /chat', error);
            res.status(500).json({ error: 'Internal system error.' });
        }
    });

/**
 * GET /:hospital_id/info
 * 
 * Get hospital public information
 */
router.get('/info', (req, res) => {
    const hospital = req.hospital;

    res.json({
        hospital_id: req.hospitalId,
        name: hospital.name,
        departments: hospital.departments || [],
        working_hours: hospital.working_hours || {},
        languages: hospital.languages || ['en', 'ar']
    });
});

/**
 * GET /:hospital_id/departments
 * 
 * Get hospital departments
 */
router.get('/departments', (req, res) => {
    const hospital = req.hospital;

    res.json({
        hospital_id: req.hospitalId,
        departments: hospital.departments || []
    });
});

/**
 * POST /:hospital_id/set-language
 * 
 * Set user's preferred language
 */
// Old /set-language removed - replaced by new button-based endpoint above

module.exports = router;
