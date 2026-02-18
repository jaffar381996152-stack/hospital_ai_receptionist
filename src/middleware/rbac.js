const { logger, auditLogger } = require('../config/logger');

/**
 * RBAC Middleware
 * Protects routes requiring Admin privileges.
 */
const requireAdmin = (req, res, next) => {
    const token = req.headers['x-admin-token'];
    const secret = process.env.ADMIN_SECRET;

    if (!secret) {
        logger.error('ADMIN_SECRET not set in environment. Denying all admin requests.');
        return res.status(500).json({ error: 'Server misconfiguration.' });
    }

    if (token && token === secret) {
        // Log access grant
        auditLogger.info({
            action: 'ADMIN_ACCESS_GRANTED',
            conversationId: req.id || 'admin',
            actor: 'admin',
            data: { path: req.path }
        });
        return next();
    }

    // Log denial
    logger.warn(`Admin access denied from IP: ${req.ip}`);
    auditLogger.info({
        action: 'ADMIN_ACCESS_DENIED',
        conversationId: req.id || 'unknown',
        actor: 'unknown_admin_attempt',
        data: { ip: req.ip, path: req.path }
    });

    return res.status(403).json({ error: 'Forbidden: Invalid Admin Token' });
};

module.exports = requireAdmin;
