/**
 * Hospital Context Middleware - Phase 2
 * 
 * SECURITY: Resolves hospital_id ONLY from URL params (req.params.hospital_id)
 * 
 * ❌ DO NOT trust:
 *    - X-Hospital-ID header
 *    - Request body hospital_id
 *    - Query parameters
 *    - Subdomain
 * 
 * ✅ ONLY trust: URL path /:hospital_id/*
 * 
 * Attaches req.hospital with the validated hospital object.
 * Returns 404 for invalid hospital IDs.
 */

const { initializeDatabase } = require('../config/productionDb');
const { getHospitalConfig, isValidHospital } = require('../config/hospitalConfig');
const { logger, auditLogger } = require('../config/logger');

/**
 * Lookup hospital from database.
 * Falls back to JSON config if DB lookup fails (for compatibility).
 * 
 * @param {string} hospitalId - The hospital_id to lookup
 * @returns {Promise<object|null>} Hospital object or null if not found
 */
async function lookupHospital(hospitalId) {
    try {
        const db = await initializeDatabase();

        const sql = 'SELECT * FROM hospitals WHERE hospital_id = $1';

        const dbHospital = await db.get(sql, [hospitalId]);

        if (dbHospital) {
            // Merge with JSON config for additional fields (departments, working_hours, etc.)
            const jsonConfig = getHospitalConfig(hospitalId);
            if (jsonConfig) {
                return {
                    ...jsonConfig,
                    hospital_id: dbHospital.hospital_id,
                    name: dbHospital.name,
                    timezone: dbHospital.timezone,
                    contact_email: dbHospital.contact_email,
                    _source: 'database'
                };
            }
            return { ...dbHospital, _source: 'database' };
        }

        // Fallback to JSON config if not in DB (backward compatibility)
        if (isValidHospital(hospitalId)) {
            const jsonConfig = getHospitalConfig(hospitalId);
            return { ...jsonConfig, _source: 'json_fallback' };
        }

        return null;
    } catch (err) {
        // If DB error, try JSON fallback
        logger.warn(`HospitalContext: DB lookup failed for ${hospitalId}, using JSON fallback`, err.message);

        if (isValidHospital(hospitalId)) {
            const jsonConfig = getHospitalConfig(hospitalId);
            return { ...jsonConfig, _source: 'json_fallback' };
        }

        return null;
    }
}

/**
 * Hospital Context Resolution Middleware
 * 
 * MUST be applied to routes with :hospital_id parameter.
 * Use with: router.use('/:hospital_id', resolveHospitalContext, ...)
 * 
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next function
 */
async function resolveHospitalContext(req, res, next) {
    // SECURITY: Extract ONLY from URL params
    const hospitalId = req.params.hospital_id;




    // Case 1: No hospital_id in URL (should not happen if routes configured correctly)
    if (!hospitalId) {
        logger.error('HospitalContext: No hospital_id in URL params');

        return res.status(404).json({
            error: 'Hospital not found',
            message: 'Hospital ID is required in the URL path.'
        });
    }

    // Sanitize and normalize
    const normalizedId = hospitalId.trim().toLowerCase();

    // Validate format (alphanumeric with underscores only)
    if (!/^[a-z0-9_]+$/.test(normalizedId)) {
        logger.warn(`HospitalContext: Invalid hospital_id format: ${hospitalId}`);

        auditLogger.info({
            action: 'HOSPITAL_CONTEXT_REJECTED',
            hospital_id: hospitalId,
            actor: 'system',
            data: {
                reason: 'Invalid format',
                ip: req.ip,
                path: req.originalUrl
            }
        });

        return res.status(404).json({
            error: 'Hospital not found',
            message: 'Invalid hospital identifier.'
        });
    }

    // Case 2: Lookup hospital
    const hospital = await lookupHospital(normalizedId);




    if (!hospital) {
        logger.error(`HospitalContext: Hospital not found: ${normalizedId}`);

        auditLogger.info({
            action: 'HOSPITAL_CONTEXT_REJECTED',
            hospital_id: normalizedId,
            actor: 'system',
            data: {
                reason: 'Hospital not found',
                ip: req.ip,
                path: req.originalUrl
            }
        });

        return res.status(404).json({
            error: 'Hospital not found',
            message: 'The specified hospital does not exist.'
        });
    }

    // Case 3: Valid hospital - attach to request
    logger.info(`HospitalContext: Resolved hospital = ${normalizedId} (${hospital.name})`);

    // Attach to BOTH req and res.locals for compatibility
    req.hospital = hospital;
    req.hospitalId = normalizedId;

    // Also maintain res.locals for backward compatibility with existing code
    res.locals.hospital = hospital;
    res.locals.hospitalId = normalizedId;

    // Log successful resolution
    auditLogger.info({
        action: 'HOSPITAL_CONTEXT_RESOLVED',
        hospital_id: normalizedId,
        actor: 'system',
        data: {
            hospital_name: hospital.name,
            source: hospital._source || 'unknown',
            path: req.originalUrl
        }
    });

    return next();
}

/**
 * Validate that request is using the correct hospital context.
 * Use this after resolveHospitalContext to ensure isolation.
 * 
 * BLOCKS requests that try to spoof hospital_id via header/body/query
 * by ensuring the URL hospital_id is the ONLY one used.
 */
function enforceHospitalIsolation(req, res, next) {
    const urlHospitalId = req.hospitalId;

    // Check for spoofing attempts (log but don't block - URL takes precedence)
    const headerHospitalId = req.headers['x-hospital-id'];
    const bodyHospitalId = req.body?.hospital_id;
    const queryHospitalId = req.query?.hospital_id;

    const spoofAttempts = [];

    if (headerHospitalId && headerHospitalId !== urlHospitalId) {
        spoofAttempts.push(`header=${headerHospitalId}`);
    }
    if (bodyHospitalId && bodyHospitalId !== urlHospitalId) {
        spoofAttempts.push(`body=${bodyHospitalId}`);
    }
    if (queryHospitalId && queryHospitalId !== urlHospitalId) {
        spoofAttempts.push(`query=${queryHospitalId}`);
    }

    if (spoofAttempts.length > 0) {
        logger.warn(`HospitalContext: Potential spoofing attempt detected. URL=${urlHospitalId}, attempts: ${spoofAttempts.join(', ')}`);

        auditLogger.info({
            action: 'HOSPITAL_SPOOF_ATTEMPT',
            hospital_id: urlHospitalId,
            actor: 'system',
            data: {
                url_hospital: urlHospitalId,
                spoof_attempts: spoofAttempts,
                ip: req.ip
            }
        });
    }

    // URL hospital_id is authoritative - proceed with URL value
    next();
}

module.exports = {
    resolveHospitalContext,
    enforceHospitalIsolation,
    lookupHospital
};
