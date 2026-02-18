const { logger } = require('../config/logger');

/**
 * Environment Validator - Phase 7 Hardening
 * 
 * Validates critical environment variables at startup.
 * Crashes the application if security requirements are not met.
 * 
 * PRODUCTION REQUIREMENTS:
 * - All secrets must be set (no fallbacks)
 * - ENCRYPTION_KEY must be 32+ chars
 * - DATABASE_URL or PG_HOST required in production
 */

const isProduction = process.env.NODE_ENV === 'production';

const validateEnv = () => {
    const errors = [];
    const warnings = [];

    // ========================================
    // REQUIRED IN ALL ENVIRONMENTS
    // ========================================

    const requiredVars = [
        'SESSION_SECRET',
        'ENCRYPTION_KEY',
        'ADMIN_SECRET',
        'OPENROUTER_API_KEY'
    ];

    for (const key of requiredVars) {
        if (!process.env[key]) {
            errors.push(`Missing required: ${key}`);
        }
    }

    // ========================================
    // SECRET STRENGTH VALIDATION
    // ========================================

    // SESSION_SECRET must be 32+ chars
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
        errors.push('SESSION_SECRET must be at least 32 characters');
    }

    // ENCRYPTION_KEY must be 32+ chars (hex recommended = 64 hex chars = 32 bytes)
    if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length < 32) {
        errors.push('ENCRYPTION_KEY must be at least 32 characters');
    }

    // ADMIN_SECRET should be strong
    if (process.env.ADMIN_SECRET && process.env.ADMIN_SECRET.length < 16) {
        warnings.push('ADMIN_SECRET is weak (recommend 16+ characters)');
    }

    // ========================================
    // PRODUCTION-ONLY REQUIREMENTS
    // ========================================

    if (isProduction) {
        // Database must be configured
        if (!process.env.DATABASE_URL && !process.env.PG_HOST) {
            errors.push('Production requires DATABASE_URL or PG_HOST');
        }

        // Redis should be configured (warn only)
        if (!process.env.REDIS_HOST && !process.env.REDIS_URL) {
            warnings.push('REDIS_HOST not set. Using default localhost:6379');
        }
    }

    // ========================================
    // OUTPUT RESULTS
    // ========================================

    // Log warnings
    for (const warn of warnings) {
        logger.warn(`⚠️ ENV WARNING: ${warn}`);
    }

    // Crash on errors
    if (errors.length > 0) {
        logger.error('╔══════════════════════════════════════════════════════════╗');
        logger.error('║ FATAL: Environment validation failed                     ║');
        logger.error('╚══════════════════════════════════════════════════════════╝');
        for (const err of errors) {
            logger.error(`  ❌ ${err}`);
        }
        logger.error('Server cannot start securely. Exiting.');
        process.exit(1);
    }

    logger.info(`✅ Environment validation passed (${isProduction ? 'PRODUCTION' : 'development'})`);
};

module.exports = validateEnv;
