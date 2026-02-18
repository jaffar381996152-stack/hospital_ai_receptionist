/**
 * Abuse Protection Middleware - Enterprise-Grade
 * 
 * PHASE 8: Layered protection system:
 * - Layer 1: Emergency bypass (ALWAYS allow emergencies)
 * - Layer 2: Hospital-aware rate limiting
 * - Layer 3: Behavioral abuse detection
 * - Layer 4: Soft blocking + escalation
 * 
 * SAFETY RULES:
 * - NEVER block emergency messages
 * - NEVER inspect message content for abuse (use hashes only)
 * - NEVER log PHI in abuse detection
 * - Soft block with warnings before hard denial
 * - Escalate to human instead of silent blocking
 * 
 * KSA CONTEXT:
 * - Hospitals often share IPs (NAT)
 * - Kiosk devices are common
 * - Higher limits for hospital networks
 */

const crypto = require('crypto');
const { logger, auditLogger } = require('../config/logger');
const { getDefaultHospital } = require('../config/hospitalConfig');

/**
 * Emergency keywords for bypass detection
 * These patterns MUST always get through, even under abuse
 */
const EMERGENCY_PATTERNS = [
    // English
    /\b(emergency|urgent|heart attack|chest pain|can't breathe|cannot breathe|stroke|bleeding|unconscious|dying|severe pain|ambulance|call 911|call 997)\b/i,
    // Arabic
    /(طوارئ|حالة طارئة|نوبة قلبية|ألم في الصدر|لا أستطيع التنفس|سكتة|نزيف|فاقد الوعي|أموت|ألم شديد|إسعاف)/i
];

/**
 * Abuse types for audit logging
 */
const ABUSE_TYPES = {
    RATE_LIMIT: 'rate_limit_exceeded',
    REPEATED_MESSAGE: 'repeated_message',
    RAPID_FIRE: 'rapid_fire_timing',
    SUSTAINED_ABUSE: 'sustained_abuse'
};

/**
 * Default rate limit configuration
 * Used when hospital doesn't specify rate_limit_config
 */
const DEFAULT_RATE_CONFIG = {
    requests_per_minute: 20,        // Per session
    requests_per_10s: 5,            // Burst limit
    is_hospital_network: false,     // Public by default
    abuse_warning_threshold: 3,     // Warnings before soft block
    abuse_block_threshold: 5,       // Warnings before hard block/escalation
    repeated_message_threshold: 3,  // Same message N times = abuse
    rapid_fire_window_ms: 300       // Requests faster than this = rapid fire
};

/**
 * Hospital network rate config (higher limits for NAT)
 */
const HOSPITAL_NETWORK_CONFIG = {
    requests_per_minute: 60,
    requests_per_10s: 15,
    is_hospital_network: true,
    abuse_warning_threshold: 5,
    abuse_block_threshold: 10,
    repeated_message_threshold: 5,
    rapid_fire_window_ms: 150
};

/**
 * Check if message is an emergency (ALWAYS bypass abuse checks)
 * 
 * CRITICAL: This runs FIRST. Emergency messages must NEVER be blocked.
 * 
 * @param {string} message - Raw message text
 * @returns {boolean}
 */
function isEmergencyMessage(message) {
    if (!message || typeof message !== 'string') return false;

    for (const pattern of EMERGENCY_PATTERNS) {
        if (pattern.test(message)) {
            return true;
        }
    }
    return false;
}

/**
 * Generate a hash of a message for repeated-message detection.
 * 
 * PRIVACY: We hash the message so we can detect repeats
 * WITHOUT storing or inspecting the actual content.
 * 
 * @param {string} message - Message text
 * @returns {string} - SHA256 hash
 */
function hashMessage(message) {
    if (!message) return '';
    // Normalize: lowercase, trim, remove extra spaces
    const normalized = message.toLowerCase().trim().replace(/\s+/g, ' ');
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Get rate config for the current context.
 * 
 * HOSPITAL-AWARE: Uses per-hospital config if available,
 * falls back to hospital network or public defaults.
 * 
 * @param {Object} hospital - Hospital configuration (may be null early in pipeline)
 * @param {Object} session - Session object
 * @returns {Object} - Rate limit configuration
 */
function getRateConfig(hospital, session) {
    // If hospital has explicit config, use it
    if (hospital?.rate_limit_config) {
        return { ...DEFAULT_RATE_CONFIG, ...hospital.rate_limit_config };
    }

    // Check if session is marked as hospital network
    if (session?.isHospitalNetwork) {
        return HOSPITAL_NETWORK_CONFIG;
    }

    // Default to public (stricter) limits
    return DEFAULT_RATE_CONFIG;
}

/**
 * Initialize or get abuse tracking state from session.
 * 
 * @param {Object} session - Express session
 * @returns {Object} - Abuse tracking state
 */
function getAbuseState(session) {
    if (!session._abuseState) {
        session._abuseState = {
            timestamps: [],           // Request timestamps for rate limiting
            messageHashes: [],        // Recent message hashes for repeat detection
            warningCount: 0,          // Warnings issued
            softBlockUntil: null,     // Soft block timestamp
            lastRequestTime: null     // For rapid-fire detection
        };
    }
    return session._abuseState;
}

/**
 * Clean old entries from abuse tracking.
 * 
 * @param {Object} state - Abuse state
 * @param {number} now - Current timestamp
 */
function cleanAbuseState(state, now) {
    // Keep only timestamps from last 60 seconds
    state.timestamps = state.timestamps.filter(t => now - t < 60000);

    // Keep only last 10 message hashes
    if (state.messageHashes.length > 10) {
        state.messageHashes = state.messageHashes.slice(-10);
    }
}

/**
 * Check for rate limit violations.
 * 
 * @param {Object} state - Abuse state
 * @param {Object} config - Rate config
 * @param {number} now - Current timestamp
 * @returns {{violated: boolean, type: string|null}}
 */
function checkRateLimits(state, config, now) {
    // Count requests in last 10 seconds
    const last10s = state.timestamps.filter(t => now - t < 10000).length;
    if (last10s >= config.requests_per_10s) {
        return { violated: true, type: ABUSE_TYPES.RATE_LIMIT };
    }

    // Count requests in last 60 seconds
    const last60s = state.timestamps.length;
    if (last60s >= config.requests_per_minute) {
        return { violated: true, type: ABUSE_TYPES.RATE_LIMIT };
    }

    return { violated: false, type: null };
}

/**
 * Check for behavioral abuse patterns.
 * 
 * PRIVACY: Uses hashes and timing only, NOT message content.
 * 
 * @param {Object} state - Abuse state
 * @param {string} messageHash - Hash of current message
 * @param {Object} config - Rate config
 * @param {number} now - Current timestamp
 * @returns {{detected: boolean, type: string|null}}
 */
function checkBehavioralAbuse(state, messageHash, config, now) {
    // CHECK 1: Repeated identical messages
    const sameHashCount = state.messageHashes.filter(h => h === messageHash).length;
    if (sameHashCount >= config.repeated_message_threshold) {
        return { detected: true, type: ABUSE_TYPES.REPEATED_MESSAGE };
    }

    // CHECK 2: Rapid-fire timing (requests too close together)
    if (state.lastRequestTime) {
        const timeSinceLast = now - state.lastRequestTime;
        if (timeSinceLast < config.rapid_fire_window_ms) {
            // Count rapid requests
            state.rapidFireCount = (state.rapidFireCount || 0) + 1;
            if (state.rapidFireCount >= 3) {
                return { detected: true, type: ABUSE_TYPES.RAPID_FIRE };
            }
        } else {
            // Reset rapid fire counter if gap is long enough
            state.rapidFireCount = 0;
        }
    }

    return { detected: false, type: null };
}

/**
 * Log abuse event for audit (PHI-SAFE).
 * 
 * CRITICAL: Log ONLY metadata, NEVER message content.
 * 
 * @param {string} sessionId - Session ID
 * @param {string} hospitalId - Hospital ID
 * @param {string} abuseType - Type of abuse detected
 * @param {Object} metadata - Additional metadata (no PHI)
 */
function logAbuseEvent(sessionId, hospitalId, abuseType, metadata = {}) {
    auditLogger.info({
        action: 'ABUSE_DETECTED',
        hospital_id: hospitalId || 'unknown',
        conversationId: sessionId,
        actor: 'system_protection',
        data: {
            abuse_type: abuseType,
            warning_count: metadata.warningCount || 0,
            timestamp: new Date().toISOString()
            // CRITICAL: NO message content, NO PHI
        }
    });
}

/**
 * Abuse Protection Middleware
 * 
 * LAYERED PROTECTION:
 * 1. Emergency bypass (FIRST)
 * 2. Soft block check (if currently blocked)
 * 3. Rate limiting
 * 4. Behavioral detection
 * 5. Warning or escalation
 */
const abuseProtection = async (req, res, next) => {
    const session = req.session;
    const now = Date.now();

    // No session = can't track, allow through (session middleware handles this)
    if (!session) return next();

    const message = req.body?.message;
    const sessionId = req.sessionID;

    // Get hospital context if available (may be set by earlier middleware or header)
    // Note: Full hospital context is resolved later, but we can check header
    const hospitalId = req.headers['x-hospital-id'] || 'default';
    let hospital = null;
    try {
        hospital = require('../config/hospitalConfig').getHospitalConfig(hospitalId);
    } catch (e) {
        // Hospital config not yet loaded, use defaults
    }

    // =========================================
    // LAYER 1: EMERGENCY BYPASS (CRITICAL)
    // =========================================
    // Emergency messages ALWAYS get through, regardless of abuse state
    if (isEmergencyMessage(message)) {
        logger.info(`Emergency message detected, bypassing abuse checks for session ${sessionId}`);
        return next();
    }

    // =========================================
    // LAYER 2: SOFT BLOCK CHECK
    // =========================================
    const state = getAbuseState(session);

    // Check if currently soft-blocked
    if (state.softBlockUntil && now < state.softBlockUntil) {
        const remaining = Math.ceil((state.softBlockUntil - now) / 1000);

        // CRITICAL: Continue tracking abuse during soft block
        // This allows escalation to trigger on sustained abuse
        state.warningCount++;

        // Check if escalation threshold reached during soft block
        const config = getRateConfig(hospital, session);
        if (state.warningCount >= config.abuse_block_threshold) {
            logger.warn(`Sustained abuse during soft block: session=${sessionId}, triggering escalation`);

            try {
                const HumanHandoffService = require('../services/humanHandoffService');
                const handoffResponse = await HumanHandoffService.triggerHandoff(
                    sessionId,
                    'Sustained Abuse',
                    hospital,
                    session,
                    'abuse_detected'
                );

                auditLogger.info({
                    action: 'ABUSE_ESCALATION',
                    hospital_id: hospitalId,
                    conversationId: sessionId,
                    actor: 'system_protection',
                    data: {
                        abuse_type: ABUSE_TYPES.SUSTAINED_ABUSE,
                        warning_count: state.warningCount
                    }
                });

                return res.json(handoffResponse);
            } catch (err) {
                logger.error('Failed to trigger abuse escalation during soft block', err);
            }
        }

        // Add artificial delay (slowdown)
        await new Promise(resolve => setTimeout(resolve, 2000));

        return res.json({
            reply: `⏳ Please slow down. You can send another message in ${remaining} seconds.`,
            warning: true
        });
    } else if (state.softBlockUntil) {
        // Block expired, reset warning count partially (but not fully)
        state.softBlockUntil = null;
        state.warningCount = Math.max(0, state.warningCount - 1);
    }

    // Clean old entries
    cleanAbuseState(state, now);

    // Get rate config for this hospital
    const config = getRateConfig(hospital, session);

    // =========================================
    // LAYER 3: RATE LIMITING
    // =========================================
    const rateCheck = checkRateLimits(state, config, now);

    // =========================================
    // LAYER 4: BEHAVIORAL ABUSE DETECTION
    // =========================================
    const messageHash = hashMessage(message);
    const behaviorCheck = checkBehavioralAbuse(state, messageHash, config, now);

    // Record this request
    state.timestamps.push(now);
    state.messageHashes.push(messageHash);
    state.lastRequestTime = now;

    // =========================================
    // LAYER 5: WARNING / SOFT BLOCK / ESCALATION
    // =========================================
    const abuseDetected = rateCheck.violated || behaviorCheck.detected;
    const abuseType = rateCheck.type || behaviorCheck.type;

    if (abuseDetected) {
        state.warningCount++;

        // Log abuse event (PHI-safe)
        logAbuseEvent(sessionId, hospitalId, abuseType, { warningCount: state.warningCount });

        logger.warn(`Abuse detected: session=${sessionId}, type=${abuseType}, warnings=${state.warningCount}`);

        // Check thresholds
        if (state.warningCount >= config.abuse_block_threshold) {
            // ESCALATION: Persistent abuse → Human handoff
            logger.warn(`Sustained abuse: session=${sessionId}, triggering escalation`);

            try {
                const HumanHandoffService = require('../services/humanHandoffService');

                // Mark session as escalated (AI will be disengaged)
                const handoffResponse = await HumanHandoffService.triggerHandoff(
                    sessionId,
                    'Abuse Detection',
                    hospital,
                    session,
                    'abuse_detected'
                );

                // Log escalation
                auditLogger.info({
                    action: 'ABUSE_ESCALATION',
                    hospital_id: hospitalId,
                    conversationId: sessionId,
                    actor: 'system_protection',
                    data: {
                        abuse_type: ABUSE_TYPES.SUSTAINED_ABUSE,
                        warning_count: state.warningCount
                    }
                });

                return res.json(handoffResponse);
            } catch (err) {
                logger.error('Failed to trigger abuse escalation', err);
                // Fall through to soft block
            }
        }

        if (state.warningCount >= config.abuse_warning_threshold) {
            // SOFT BLOCK: Impose temporary slowdown
            state.softBlockUntil = now + 30000; // 30 second soft block

            return res.json({
                reply: "⚠️ You're sending messages too quickly. Please wait a moment before trying again. If you need urgent assistance, please call the hospital directly.",
                warning: true
            });
        }

        // WARNING: First few violations get a gentle warning
        // But still process the request (add slight delay)
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    next();
};

/**
 * Mark a session as coming from a hospital network.
 * This grants higher rate limits.
 * 
 * Called by hospital context middleware when IP matches hospital range.
 * 
 * @param {Object} session - Express session
 */
function markAsHospitalNetwork(session) {
    if (session) {
        session.isHospitalNetwork = true;
    }
}

/**
 * Get current abuse state for a session (for testing/admin).
 * 
 * @param {Object} session - Express session
 * @returns {Object} - Sanitized abuse state
 */
function getAbuseStatus(session) {
    if (!session?._abuseState) return { clean: true };

    const state = session._abuseState;
    return {
        warningCount: state.warningCount,
        isSoftBlocked: state.softBlockUntil > Date.now(),
        requestsInLastMinute: state.timestamps.length,
        clean: state.warningCount === 0
    };
}

module.exports = abuseProtection;
module.exports.isEmergencyMessage = isEmergencyMessage;
module.exports.markAsHospitalNetwork = markAsHospitalNetwork;
module.exports.getAbuseStatus = getAbuseStatus;
module.exports.ABUSE_TYPES = ABUSE_TYPES;
