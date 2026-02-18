/**
 * Retention Service
 * 
 * PHASE 9: Automatic data retention enforcement
 * - Per-hospital retention periods
 * - Scheduled purge of old records
 * - Audit-safe (logs purge events)
 * 
 * COMPLIANCE:
 * - Enforces data minimization
 * - Hospital-scoped deletion
 * - No PHI in logs
 */

const { logger, auditLogger } = require('../config/logger');
const { getHospitalConfig, getAllHospitalIds } = require('../config/hospitalConfig');

/**
 * Default retention periods (days/hours)
 */
const DEFAULT_RETENTION = {
    audit_logs_days: 365,           // 1 year for compliance
    escalation_records_days: 90,
    session_metadata_days: 7,
    unconfirmed_booking_hours: 24,  // Expire pending bookings after 24h
    completed_appointments_days: 180, // Soft-delete after 6 months
    otp_expiry_minutes: 10          // OTP cleanup
};

/**
 * Get retention config for a hospital.
 * 
 * @param {string} hospitalId - Hospital ID
 * @returns {Object} - Retention configuration
 */
function getRetentionConfig(hospitalId) {
    try {
        const hospital = getHospitalConfig(hospitalId);
        return { ...DEFAULT_RETENTION, ...hospital?.retention_config };
    } catch (err) {
        return DEFAULT_RETENTION;
    }
}

/**
 * Purge old records from a table.
 * 
 * @param {Object} db - Database adapter
 * @param {string} table - Table name
 * @param {string} hospitalId - Hospital ID
 * @param {number} retentionDays - Days to keep
 * @returns {number} - Number of records deleted
 */
async function purgeTable(db, table, hospitalId, retentionDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffIso = cutoffDate.toISOString();

    // audit_logs uses 'timestamp' column, all others use 'created_at'
    const dateColumn = (table === 'audit_logs') ? 'timestamp' : 'created_at';

    // PostgreSQL syntax
    const sql = `DELETE FROM ${table} WHERE hospital_id = $1 AND ${dateColumn} < $2`;
    const params = [hospitalId, cutoffIso];

    try {
        const result = await db.execute(sql, params);
        const deleted = result.rowCount || result.changes || 0;

        if (deleted > 0) {
            logger.info(`Purged ${deleted} records from ${table} for hospital ${hospitalId}`);

            // Audit log the purge (no PHI)
            auditLogger.info({
                action: 'RETENTION_PURGE',
                hospital_id: hospitalId,
                data: {
                    table,
                    records_deleted: deleted,
                    retention_days: retentionDays,
                    cutoff_date: cutoffIso
                }
            });
        }

        return deleted;
    } catch (err) {
        logger.error(`Failed to purge ${table} for hospital ${hospitalId}:`, err);
        return 0;
    }
}

/**
 * Run retention enforcement for a single hospital.
 * 
 * @param {Object} db - Database adapter
 * @param {string} hospitalId - Hospital ID
 * @returns {Object} - Purge results
 */
async function enforceRetentionForHospital(db, hospitalId) {
    const config = getRetentionConfig(hospitalId);
    const results = {};

    // Purge audit_logs
    results.audit_logs = await purgeTable(
        db, 'audit_logs', hospitalId, config.audit_logs_days
    );

    // Purge escalation_records
    results.escalation_records = await purgeTable(
        db, 'escalation_records', hospitalId, config.escalation_records_days
    );

    // Purge session_metadata
    results.session_metadata = await purgeTable(
        db, 'session_metadata', hospitalId, config.session_metadata_days
    );

    return results;
}

/**
 * Run retention enforcement for all hospitals.
 * Should be called on startup or via scheduled job.
 * 
 * @param {Object} db - Database adapter
 * @returns {Object} - Summary of purge operations
 */
async function enforceRetentionAll(db) {
    logger.info('Starting retention enforcement for all hospitals');

    const hospitalIds = getAllHospitalIds();
    const summary = { hospitals: 0, totalDeleted: 0 };

    for (const hospitalId of hospitalIds) {
        const results = await enforceRetentionForHospital(db, hospitalId);

        const deleted = Object.values(results).reduce((a, b) => a + b, 0);
        if (deleted > 0) {
            summary.hospitals++;
            summary.totalDeleted += deleted;
        }
    }

    logger.info(`Retention enforcement complete: ${summary.totalDeleted} records purged across ${summary.hospitals} hospitals`);
    return summary;
}

/**
 * Check if table exists (for safe purge).
 */
async function tableExists(db, tableName) {
    try {
        const result = await db.get(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1) as exists",
            [tableName]
        );
        return result?.exists;
    } catch (err) {
        return false;
    }
}

/**
 * Safe enforcement that checks tables exist first.
 */
async function enforceRetentionSafe(db) {
    // Check tables exist before purging
    const tables = ['audit_logs', 'escalation_records', 'session_metadata'];

    for (const table of tables) {
        if (!await tableExists(db, table)) {
            logger.warn(`Table ${table} does not exist, skipping retention enforcement`);
            return { skipped: true, reason: 'tables_not_ready' };
        }
    }

    return await enforceRetentionAll(db);
}

/**
 * Expire unconfirmed bookings older than configured hours.
 * Sets status to 'expired' instead of deleting.
 * 
 * PHASE 10: Booking lifecycle cleanup
 * 
 * @param {Object} db - Database adapter
 * @param {string} hospitalId - Hospital ID
 * @param {number} hoursOld - Hours after which to expire (default 24)
 * @returns {Promise<number>} Number of bookings expired
 */
async function expireUnconfirmedBookings(db, hospitalId, hoursOld = 24) {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hoursOld);
    const cutoffIso = cutoffDate.toISOString();


    // Only expire pending/initiated bookings, NOT confirmed
    const sql = `UPDATE appointments 
           SET status = 'expired'
           WHERE hospital_id = $1 
           AND status IN ('pending', 'initiated', 'awaiting_otp')
           AND created_at < $2`;

    try {
        const result = await db.execute(sql, [hospitalId, cutoffIso]);
        const expired = result.rowCount || result.changes || 0;

        if (expired > 0) {
            logger.info(`Expired ${expired} unconfirmed bookings for hospital ${hospitalId}`);

            auditLogger.info({
                action: 'BOOKING_BATCH_EXPIRED',
                hospital_id: hospitalId,
                data: { count: expired, cutoff_hours: hoursOld }
            });
        }

        return expired;
    } catch (err) {
        logger.error(`Failed to expire bookings for hospital ${hospitalId}:`, err);
        return 0;
    }
}

/**
 * Clean up expired OTPs from database.
 * 
 * @param {Object} db - Database adapter
 * @param {string} hospitalId - Hospital ID
 * @returns {Promise<number>} Number of OTPs cleaned
 */
async function cleanupExpiredOtps(db, hospitalId) {
    const now = new Date().toISOString();

    // Clear OTP data from appointments where OTP has expired
    const sql = `UPDATE appointments 
           SET otp_hash = NULL, otp_expires_at = NULL
           WHERE hospital_id = $1 
           AND otp_expires_at IS NOT NULL 
           AND otp_expires_at < $2`;

    try {
        const result = await db.execute(sql, [hospitalId, now]);
        const cleaned = result.rowCount || result.changes || 0;

        if (cleaned > 0) {
            logger.info(`Cleaned ${cleaned} expired OTPs for hospital ${hospitalId}`);
        }

        return cleaned;
    } catch (err) {
        logger.error(`Failed to cleanup OTPs for hospital ${hospitalId}:`, err);
        return 0;
    }
}

/**
 * Archive (soft-delete) old completed appointments.
 * Sets status to 'archived' for appointments older than configured days.
 * 
 * SAFETY: Only archives 'completed' or 'no_show' appointments, never active ones.
 * 
 * @param {Object} db - Database adapter
 * @param {string} hospitalId - Hospital ID
 * @param {number} daysOld - Days after which to archive (default 180)
 * @returns {Promise<number>} Number of appointments archived
 */
async function archiveOldAppointments(db, hospitalId, daysOld = 180) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffIso = cutoffDate.toISOString();


    // SAFETY: Only archive completed/no_show, never pending/confirmed
    const sql = `UPDATE appointments 
           SET status = 'archived'
           WHERE hospital_id = $1 
           AND status IN ('completed', 'no_show', 'cancelled', 'expired')
           AND appointment_time < $2`;

    try {
        const result = await db.execute(sql, [hospitalId, cutoffIso]);
        const archived = result.rowCount || result.changes || 0;

        if (archived > 0) {
            logger.info(`Archived ${archived} old appointments for hospital ${hospitalId}`);

            auditLogger.info({
                action: 'APPOINTMENTS_ARCHIVED',
                hospital_id: hospitalId,
                data: { count: archived, retention_days: daysOld }
            });
        }

        return archived;
    } catch (err) {
        logger.error(`Failed to archive appointments for hospital ${hospitalId}:`, err);
        return 0;
    }
}

/**
 * Run full retention job for a hospital.
 * Includes booking expiry, OTP cleanup, and appointment archival.
 * 
 * @param {Object} db - Database adapter
 * @param {string} hospitalId - Hospital ID
 * @returns {Promise<Object>} Summary of all retention operations
 */
async function runFullRetention(db, hospitalId) {
    const config = getRetentionConfig(hospitalId);

    const results = {
        // Original retention
        ...await enforceRetentionForHospital(db, hospitalId),

        // Phase 10 additions
        bookings_expired: await expireUnconfirmedBookings(
            db, hospitalId, config.unconfirmed_booking_hours || 24
        ),
        otps_cleaned: await cleanupExpiredOtps(db, hospitalId),
        appointments_archived: await archiveOldAppointments(
            db, hospitalId, config.completed_appointments_days || 180
        )
    };

    return results;
}

module.exports = {
    enforceRetentionForHospital,
    enforceRetentionAll,
    enforceRetentionSafe,
    getRetentionConfig,
    DEFAULT_RETENTION,
    // Phase 10 exports
    expireUnconfirmedBookings,
    cleanupExpiredOtps,
    archiveOldAppointments,
    runFullRetention
};
