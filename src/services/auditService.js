/**
 * Audit Service - Phase 10
 * 
 * Centralized audit logging for compliance and operational safety.
 * 
 * DESIGN:
 * - Logs to both file (via auditLogger) and database (audit_logs table)
 * - No PHI in audit logs
 * - Hospital-scoped for multi-tenant isolation
 * 
 * EVENTS TRACKED:
 * - Booking: created, confirmed, cancelled, expired
 * - Check-in: patient checked in
 * - Staff: login, logout
 * - System: retention, shutdown
 */

const { auditLogger, logger } = require('../config/logger');
const { initializeDatabase } = require('../config/productionDb');

// Entity types
const ENTITY_TYPES = {
    BOOKING: 'booking',
    OTP: 'otp',
    CHECKIN: 'checkin',
    STAFF: 'staff',
    SYSTEM: 'system'
};

// Action types
const ACTIONS = {
    // Booking
    BOOKING_CREATED: 'BOOKING_CREATED',
    BOOKING_CONFIRMED: 'BOOKING_CONFIRMED',
    BOOKING_CANCELLED: 'BOOKING_CANCELLED',
    BOOKING_EXPIRED: 'BOOKING_EXPIRED',

    // OTP
    OTP_GENERATED: 'OTP_GENERATED',
    OTP_VERIFIED: 'OTP_VERIFIED',
    OTP_FAILED: 'OTP_FAILED',
    OTP_EXPIRED: 'OTP_EXPIRED',

    // Check-in
    PATIENT_CHECKED_IN: 'PATIENT_CHECKED_IN',

    // Staff
    STAFF_LOGIN: 'STAFF_LOGIN',
    STAFF_LOGOUT: 'STAFF_LOGOUT',
    STAFF_LOGIN_FAILED: 'STAFF_LOGIN_FAILED',

    // System
    RETENTION_PURGE: 'RETENTION_PURGE',
    SYSTEM_SHUTDOWN: 'SYSTEM_SHUTDOWN',
    SYSTEM_STARTUP: 'SYSTEM_STARTUP'
};

class AuditService {
    /**
     * Log an audit event.
     * 
     * @param {Object} event - Audit event details
     * @param {string} event.hospitalId - Hospital ID
     * @param {string} event.entityType - Type of entity (booking, staff, etc.)
     * @param {string} event.entityId - ID of the affected entity
     * @param {string} event.action - Action performed
     * @param {string} event.performedBy - Who performed the action
     * @param {Object} event.metadata - Additional context (NO PHI)
     */
    static async log({ hospitalId, entityType, entityId, action, performedBy, metadata = {} }) {
        const timestamp = new Date().toISOString();

        // Always log to file (via auditLogger)
        auditLogger.info({
            action,
            hospital_id: hospitalId,
            entity_type: entityType,
            entity_id: entityId,
            performed_by: performedBy,
            timestamp,
            data: metadata
        });

        // Attempt to log to database (non-blocking)
        try {
            await this._logToDatabase({
                hospitalId,
                entityType,
                entityId,
                action,
                performedBy,
                timestamp,
                metadata
            });
        } catch (err) {
            // Log failure but don't block the operation
            logger.error('AuditService: Failed to write to database', {
                error: err.message,
                action,
                entityType
            });
        }
    }

    /**
     * Write audit log to database.
     * @private
     */
    static async _logToDatabase({ hospitalId, entityType, entityId, action, performedBy, timestamp, metadata }) {
        const db = await initializeDatabase();

        const sql = `INSERT INTO audit_logs 
               (hospital_id, entity_type, entity_id, action, performed_by, timestamp, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`;

        await db.execute(sql, [
            hospitalId,
            entityType,
            entityId,
            action,
            performedBy,
            timestamp,
            metadata
        ]);
    }

    /**
     * Query audit logs for a hospital.
     * 
     * @param {string} hospitalId - Hospital ID
     * @param {Object} options - Query options
     * @param {string} options.entityType - Filter by entity type
     * @param {string} options.action - Filter by action
     * @param {Date} options.startDate - Start of date range
     * @param {Date} options.endDate - End of date range
     * @param {number} options.limit - Max results (default 100)
     * @returns {Promise<Array>} Audit log entries
     */
    static async query(hospitalId, options = {}) {
        const db = await initializeDatabase();

        const conditions = ['hospital_id = $1'];
        const params = [hospitalId];
        let paramIndex = 2;

        if (options.entityType) {
            conditions.push(`entity_type = $${paramIndex++}`);
            params.push(options.entityType);
        }

        if (options.action) {
            conditions.push(`action = $${paramIndex++}`);
            params.push(options.action);
        }

        if (options.startDate) {
            conditions.push(`timestamp >= $${paramIndex++}`);
            params.push(options.startDate.toISOString());
        }

        if (options.endDate) {
            conditions.push(`timestamp <= $${paramIndex++}`);
            params.push(options.endDate.toISOString());
        }

        const limit = options.limit || 100;
        const sql = `SELECT * FROM audit_logs 
                     WHERE ${conditions.join(' AND ')} 
                     ORDER BY timestamp DESC 
                     LIMIT ${limit}`;

        return await db.query(sql, params) || [];
    }

    // Convenience methods for common events
    static async logBookingCreated(hospitalId, bookingId, performedBy = 'system') {
        return this.log({
            hospitalId,
            entityType: ENTITY_TYPES.BOOKING,
            entityId: bookingId,
            action: ACTIONS.BOOKING_CREATED,
            performedBy
        });
    }

    static async logBookingConfirmed(hospitalId, bookingId, performedBy = 'system') {
        return this.log({
            hospitalId,
            entityType: ENTITY_TYPES.BOOKING,
            entityId: bookingId,
            action: ACTIONS.BOOKING_CONFIRMED,
            performedBy
        });
    }

    static async logBookingCancelled(hospitalId, bookingId, performedBy, reason) {
        return this.log({
            hospitalId,
            entityType: ENTITY_TYPES.BOOKING,
            entityId: bookingId,
            action: ACTIONS.BOOKING_CANCELLED,
            performedBy,
            metadata: { reason }
        });
    }

    static async logBookingExpired(hospitalId, bookingId) {
        return this.log({
            hospitalId,
            entityType: ENTITY_TYPES.BOOKING,
            entityId: bookingId,
            action: ACTIONS.BOOKING_EXPIRED,
            performedBy: 'system'
        });
    }

    static async logPatientCheckedIn(hospitalId, appointmentId, performedBy) {
        return this.log({
            hospitalId,
            entityType: ENTITY_TYPES.CHECKIN,
            entityId: appointmentId,
            action: ACTIONS.PATIENT_CHECKED_IN,
            performedBy
        });
    }

    static async logStaffLogin(hospitalId, username) {
        return this.log({
            hospitalId,
            entityType: ENTITY_TYPES.STAFF,
            entityId: username,
            action: ACTIONS.STAFF_LOGIN,
            performedBy: username
        });
    }

    static async logStaffLogout(hospitalId, username) {
        return this.log({
            hospitalId,
            entityType: ENTITY_TYPES.STAFF,
            entityId: username,
            action: ACTIONS.STAFF_LOGOUT,
            performedBy: username
        });
    }

    static async logStaffLoginFailed(hospitalId, username, reason) {
        return this.log({
            hospitalId,
            entityType: ENTITY_TYPES.STAFF,
            entityId: username,
            action: ACTIONS.STAFF_LOGIN_FAILED,
            performedBy: 'system',
            metadata: { reason }
        });
    }
}

module.exports = { AuditService, ENTITY_TYPES, ACTIONS };
