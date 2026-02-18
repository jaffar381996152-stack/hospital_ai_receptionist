/**
 * Reception Auth Middleware - Phase 6/8
 * 
 * Protects reception dashboard routes.
 * 
 * Features:
 * - Session-based authentication check
 * - Hospital isolation enforcement
 * - Role-based access control (Phase 8)
 * - Auto-logout on session expiry
 * 
 * SECURITY:
 * - Verifies req.session.receptionUser exists
 * - Enforces user.hospitalId === req.hospitalId
 * - Returns 401 for unauthenticated requests
 */

const { logger, auditLogger } = require('../config/logger');

/**
 * Require authenticated reception user.
 * Must be used AFTER resolveHospitalContext middleware.
 */
const requireReceptionAuth = (req, res, next) => {
    const receptionUser = req.session?.receptionUser;

    // Check if user is logged in
    if (!receptionUser) {
        logger.warn(`ReceptionAuth: Unauthorized access attempt to ${req.path}`);
        return res.status(401).json({
            error: 'Authentication required',
            redirect: `/${req.hospitalId}/reception`
        });
    }

    // CRITICAL: Enforce hospital isolation
    // User can only access their own hospital's dashboard
    if (receptionUser.hospitalId !== req.hospitalId) {
        auditLogger.warn({
            action: 'RECEPTION_CROSS_HOSPITAL_BLOCKED',
            hospital_id: req.hospitalId,
            actor: receptionUser.username,
            data: {
                user_hospital: receptionUser.hospitalId,
                requested_hospital: req.hospitalId
            }
        });

        logger.warn(`ReceptionAuth: Cross-hospital access blocked - ${receptionUser.username} tried to access ${req.hospitalId}`);

        return res.status(403).json({
            error: 'Access denied. You can only access your assigned hospital.'
        });
    }

    // Attach user to request for downstream use
    req.receptionUser = receptionUser;

    next();
};

/**
 * Require specific role(s).
 * Phase 8: Role-based access control.
 * 
 * @param {...string} roles - Allowed roles
 */
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.receptionUser) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.receptionUser.role)) {
            auditLogger.warn({
                action: 'RECEPTION_ROLE_DENIED',
                hospital_id: req.hospitalId,
                actor: req.receptionUser.username,
                data: {
                    user_role: req.receptionUser.role,
                    required_roles: roles,
                    path: req.path
                }
            });

            logger.warn(`ReceptionAuth: Role denied - ${req.receptionUser.username} (${req.receptionUser.role}) tried to access ${req.path}`);

            return res.status(403).json({
                error: 'Insufficient permissions for this action'
            });
        }

        next();
    };
};

/**
 * Shortcut: Require reception or admin role.
 * Doctors cannot perform this action.
 */
const requireReceptionOnly = requireRole('reception', 'receptionist', 'admin', 'manager');

/**
 * Optional: Rate limiting for login endpoint.
 * Uses the existing rate limiting infrastructure.
 */
const loginRateLimiter = require('express-rate-limit').rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    // Disable ALL validations to stop the crash
    validate: {
        default: false
    },
    keyGenerator: (req) => {
        // Rate limit by IP + hospital + username
        return `${req.ip || 'unknown'}:${req.hospitalId || 'unknown'}:${req.body?.username || 'unknown'}`;
    }
});

module.exports = { requireReceptionAuth, requireRole, requireReceptionOnly, loginRateLimiter };
