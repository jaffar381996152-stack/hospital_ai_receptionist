const { logger, auditLogger } = require('../config/logger');

const RATE_LIMIT_WINDOW = 10 * 1000; // 10 seconds
const MAX_MESSAGES_PER_WINDOW = 5;
const BLOCK_DURATION = 60 * 1000; // 1 minute

const abuseDetection = (req, res, next) => {
    const session = req.session;
    if (!session) return next();

    const now = Date.now();

    // 1. Check if currently blocked
    if (session.abuseBlockedUntil) {
        if (now < session.abuseBlockedUntil) {
            const remaining = Math.ceil((session.abuseBlockedUntil - now) / 1000);
            logger.warn(`Blocked Request from Session ${req.sessionID} (Remaining: ${remaining}s)`);
            return res.status(429).json({
                error: `You are sending messages too quickly. Please wait ${remaining} seconds.`
            });
        } else {
            // Block expired, reset
            delete session.abuseBlockedUntil;
            session.messageTimestamps = [];
        }
    }

    // 2. Initialize tracking
    if (!session.messageTimestamps) {
        session.messageTimestamps = [];
    }

    // 3. Clean old timestamps
    session.messageTimestamps = session.messageTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW);

    // 4. Record new message
    session.messageTimestamps.push(now);

    // 5. Check limit
    if (session.messageTimestamps.length > MAX_MESSAGES_PER_WINDOW) {
        logger.warn(`Abuse Detected: Session ${req.sessionID} sent ${session.messageTimestamps.length} msgs in 10s. Blocking.`);

        auditLogger.info({
            action: 'ABUSE_DETECTED',
            conversationId: req.sessionID,
            actor: 'system_protection',
            data: { reason: 'Speed Limit Exceeded', rate: `${session.messageTimestamps.length} msgs / 10s` }
        });

        session.abuseBlockedUntil = now + BLOCK_DURATION;
        return res.status(429).json({
            error: "You are sending messages too quickly. Please wait 1 minute."
        });
    }

    next();
};

module.exports = abuseDetection;
