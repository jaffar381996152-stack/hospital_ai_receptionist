/**
 * Booking Service - Phase 4
 * 
 * MULTI-TENANT: All queries are scoped by hospital_id.
 * 
 * Uses SlotService for dynamic slot generation.
 * Uses BookingStateMachine for lifecycle management.
 * Uses OtpService for secure OTP verification.
 */

const { initializeDatabase } = require('../config/productionDb');
const SlotService = require('./slotService');
const { BookingStateMachine, BOOKING_STATES } = require('./bookingStateMachine');
const { AuditService } = require('./auditService');
const { OtpService } = require('./otpService');
const BookingNotificationService = require('./bookingNotificationService');
const { logger, auditLogger } = require('../config/logger');
const { encrypt, decrypt } = require('../utils/encryption');

// ... existing imports ...



class BookingService {

    /**
     * Get available slots for a department.
     * 
     * MULTI-TENANT: Filters by hospital_id.
     * PHASE 3: Uses dynamic slot generation.
     * 
     * @param {string} department - Department name
     * @param {string} hospitalId - Hospital identifier
     * @param {string} date - Date (YYYY-MM-DD) - optional, defaults to today
     * @returns {Promise<Array>} Available slots
     */
    static async getAvailableSlots(department, hospitalId = 'default', date = null) {
        // Default to today if no date provided
        if (!date) {
            const today = new Date();
            date = today.toISOString().split('T')[0];
        }

        logger.info(`BookingService: Fetching slots for ${department} at hospital ${hospitalId} on ${date}`);

        // Use SlotService for dynamic slot generation
        return await SlotService.getAvailableSlots(hospitalId, department, date);
    }

    /**
     * Lock a slot for booking (temporary hold during OTP verification).
     * 
     * PHASE 3: Uses Redis-based locking via SlotService.
     * 
     * @param {number} doctorId - Doctor ID
     * @param {string} datetime - Slot datetime
     * @param {string} sessionId - Session ID
     * @param {string} hospitalId - Hospital identifier
     * @returns {Promise<boolean>} Success status
     */
    static async lockSlot(doctorId, datetime, sessionId, hospitalId = 'default') {
        logger.info(`BookingService: Locking slot ${datetime} for doctor ${doctorId} at hospital ${hospitalId}`);

        return await SlotService.lockSlot(hospitalId, doctorId, datetime, sessionId);
    }

    /**
     * Unlock a slot (e.g., if user cancels before confirming).
     * 
     * @param {number} doctorId - Doctor ID
     * @param {string} datetime - Slot datetime
     * @param {string} sessionId - Session ID (must be owner)
     * @param {string} hospitalId - Hospital identifier
     * @returns {Promise<boolean>} Success status
     */
    static async unlockSlot(doctorId, datetime, sessionId, hospitalId = 'default') {
        logger.info(`BookingService: Unlocking slot ${datetime} for doctor ${doctorId} at hospital ${hospitalId}`);

        return await SlotService.unlockSlot(hospitalId, doctorId, datetime, sessionId);
    }

    /**
     * Confirm booking.
     * 
     * PHASE 3: Inserts into appointments table (new schema).
     * PHI is encrypted before storage.
     * 
     * @param {Object} bookingData - Booking details
     * @param {string} bookingData.hospitalId - Hospital ID
     * @param {number} bookingData.doctorId - Doctor ID
     * @param {string} bookingData.datetime - Appointment datetime
     * @param {string} bookingData.patientName - Patient name
     * @param {string} bookingData.patientPhone - Patient phone
     * @param {string} bookingData.patientEmail - Patient email (optional)
     * @param {string} sessionId - Session ID (for unlocking)
     * @returns {Promise<Object|null>} Appointment record or null on failure
     */
    static async confirmBooking(bookingData, sessionId) {
        const {
            hospitalId = 'default',
            doctorId,
            datetime,
            patientName,
            patientPhone,
            patientEmail = null
        } = bookingData;

        try {
            const db = await initializeDatabase();

            logger.info(`BookingService: Confirming booking for ${datetime} at hospital ${hospitalId}`);

            // PHASE 9: Verify lock ownership before DB insert
            // This double-check prevents race conditions where lock could expire
            // between initiating and confirming the booking
            const ownsLock = await SlotService.verifyLock(hospitalId, doctorId, datetime, sessionId);
            if (!ownsLock) {
                logger.warn(`BookingService: Lock verification failed for ${datetime} - slot may have been taken`);

                auditLogger.warn({
                    action: 'BOOKING_LOCK_EXPIRED',
                    hospital_id: hospitalId,
                    actor: 'system',
                    data: { doctor_id: doctorId, datetime, session_id: sessionId }
                });

                return null;
            }

            // Encrypt PHI before storage
            const encryptedName = encrypt(patientName);
            const encryptedPhone = encrypt(patientPhone);
            const encryptedEmail = patientEmail ? encrypt(patientEmail) : null;

            // Insert into appointments table (PostgreSQL)
            const sql = `INSERT INTO appointments 
                   (hospital_id, doctor_id, patient_name_encrypted, patient_phone_encrypted, 
                    patient_email_encrypted, appointment_time, status) 
                   VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
                   RETURNING id`;

            const result = await db.execute(sql, [
                hospitalId,
                doctorId,
                encryptedName,
                encryptedPhone,
                encryptedEmail,
                datetime
            ]);

            // Unlock the slot (it's now booked, not locked)
            await SlotService.unlockSlot(hospitalId, doctorId, datetime, sessionId);

            // Get the inserted ID
            const appointmentId = result.rows?.[0]?.id;

            // Audit log
            await AuditService.logBookingConfirmed(hospitalId, appointmentId, 'system');

            logger.info(`BookingService: Booking confirmed - Appointment ID ${appointmentId}`);

            return {
                id: appointmentId,
                hospital_id: hospitalId,
                doctor_id: doctorId,
                appointment_time: datetime,
                status: 'confirmed'
            };

        } catch (err) {
            logger.error(`BookingService: Booking confirmation failed at hospital ${hospitalId}`, err);
            return null;
        }
    }

    /**
     * Find a slot by fuzzy time.
     * 
     * PHASE 3: Uses SlotService for dynamic lookup.
     * 
     * @param {string} department - Department name
     * @param {string} dateStr - Date string (YYYY-MM-DD)
     * @param {string} timeStr - Time string (HH:MM)
     * @param {string} hospitalId - Hospital identifier
     * @returns {Promise<Object|null>} Slot object or null
     */
    static async findSlotByTime(department, dateStr, timeStr, hospitalId = 'default') {
        logger.info(`BookingService: Finding slot at ${dateStr} ${timeStr} for ${department} at hospital ${hospitalId}`);

        return await SlotService.findSlot(hospitalId, department, dateStr, timeStr);
    }

    /**
     * Get appointment by ID.
     * 
     * @param {number} appointmentId - Appointment ID
     * @param {string} hospitalId - Hospital ID (for isolation)
     * @returns {Promise<Object|null>} Appointment or null
     */
    static async getAppointment(appointmentId, hospitalId) {
        const db = await initializeDatabase();

        const sql = `SELECT * FROM appointments WHERE id = $1 AND hospital_id = $2`;

        try {
            const result = await db.get(sql, [appointmentId, hospitalId]);

            if (result) {
                // Decrypt PHI for return
                return {
                    ...result,
                    patient_name: result.patient_name_encrypted ? decrypt(result.patient_name_encrypted) : null,
                    patient_phone: result.patient_phone_encrypted ? decrypt(result.patient_phone_encrypted) : null,
                    patient_email: result.patient_email_encrypted ? decrypt(result.patient_email_encrypted) : null
                };
            }

            return null;
        } catch (err) {
            logger.error(`BookingService: Failed to get appointment ${appointmentId}`, err);
            return null;
        }
    }

    /**
     * Cancel an appointment.
     * 
     * @param {number} appointmentId - Appointment ID
     * @param {string} hospitalId - Hospital ID
     * @returns {Promise<boolean>} Success
     */
    static async cancelAppointment(appointmentId, hospitalId) {
        const db = await initializeDatabase();

        const sql = `UPDATE appointments SET status = 'cancelled' WHERE id = $1 AND hospital_id = $2`;

        try {
            const result = await db.execute(sql, [appointmentId, hospitalId]);

            await AuditService.logBookingCancelled(hospitalId, appointmentId, 'system', 'User cancelled');

            return result.changes > 0 || result.rowCount > 0;
        } catch (err) {
            logger.error(`BookingService: Failed to cancel appointment ${appointmentId}`, err);
            return false;
        }
    }

    // ============================================================
    // PHASE 4: State Machine Flow Methods
    // ============================================================

    /**
     * Initiate a new booking.
     * Creates booking in INITIATED state, locks the slot.
     * 
     * @param {Object} bookingData - Booking details
     * @param {string} sessionId - Session ID
     * @returns {Promise<Object>} { success, booking, error }
     */
    static async initiateBooking(bookingData, sessionId) {
        const { hospitalId, doctorId, datetime, patientName, patientPhone, patientEmail } = bookingData;

        try {
            // Lock the slot first
            const locked = await SlotService.lockSlot(hospitalId, doctorId, datetime, sessionId);

            if (!locked) {
                logger.warn(`BookingService: Slot already locked for ${datetime}`);
                return {
                    success: false,
                    error: 'This slot is no longer available. Please choose another time.'
                };
            }

            // Create booking in INITIATED state
            const booking = await BookingStateMachine.createBooking({
                hospitalId,
                doctorId,
                datetime,
                patientName,
                patientPhone,
                patientEmail
            }, sessionId);

            logger.info(`BookingService: Initiated booking ${booking.id}`);

            await AuditService.logBookingCreated(hospitalId, booking.id, 'system');

            return {
                success: true,
                booking
            };

        } catch (err) {
            logger.error('BookingService: Failed to initiate booking', err);
            return {
                success: false,
                error: 'Failed to create booking. Please try again.'
            };
        }
    }

    /**
     * Request OTP for a booking.
     * Transitions booking to AWAITING_OTP state.
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<Object>} { success, otp?, error? }
     */
    static async requestOtpForBooking(bookingId) {
        try {
            const booking = await BookingStateMachine.getBooking(bookingId);

            if (!booking) {
                return { success: false, error: 'Booking not found or expired.' };
            }

            if (booking.state !== BOOKING_STATES.INITIATED && booking.state !== BOOKING_STATES.AWAITING_OTP) {
                return { success: false, error: `Cannot send OTP - booking is ${booking.state}.` };
            }

            // Generate OTP (with rate limiting)
            const otpResult = await OtpService.generateOtp(bookingId, booking.patientPhone);

            if (!otpResult.success) {
                return { success: false, error: otpResult.error };
            }

            // Transition to AWAITING_OTP
            if (booking.state === BOOKING_STATES.INITIATED) {
                await BookingStateMachine.sendOtp(bookingId);
            }

            logger.info(`BookingService: OTP sent for booking ${bookingId}`);

            return {
                success: true,
                otp: otpResult.otp  // Return for sending to patient
            };

        } catch (err) {
            logger.error(`BookingService: Failed to request OTP for ${bookingId}`, err);
            return { success: false, error: 'Failed to send OTP. Please try again.' };
        }
    }

    /**
     * Confirm booking with OTP verification.
     * Transitions to CONFIRMED, persists to DB, sends notifications.
     * 
     * @param {string} bookingId - Booking ID
     * @param {string} otpCode - OTP entered by user
     * @param {Object} hospital - Hospital config (for notifications)
     * @returns {Promise<Object>} { success, appointment?, error? }
     */
    static async confirmBookingWithOtp(bookingId, otpCode, hospital) {
        try {
            const booking = await BookingStateMachine.getBooking(bookingId);

            if (!booking) {
                return { success: false, error: 'Booking not found or expired.' };
            }

            if (booking.state !== BOOKING_STATES.AWAITING_OTP) {
                return { success: false, error: `Cannot confirm - booking is ${booking.state}.` };
            }

            // Verify OTP
            const otpResult = await OtpService.verifyOtp(bookingId, otpCode);

            if (!otpResult.valid) {
                return { success: false, error: otpResult.error };
            }

            // Transition to CONFIRMED
            await BookingStateMachine.confirm(bookingId);

            // Persist to database
            const appointment = await this.confirmBooking({
                hospitalId: booking.hospitalId,
                doctorId: booking.doctorId,
                datetime: booking.datetime,
                patientName: booking.patientName,
                patientPhone: booking.patientPhone,
                patientEmail: booking.patientEmail
            }, booking.sessionId);

            if (!appointment) {
                // Rollback state (shouldn't happen normally)
                await BookingStateMachine.cancel(bookingId, 'Database error');
                return { success: false, error: 'Failed to save booking. Please try again.' };
            }

            // Send notifications
            await BookingNotificationService.notifyConfirmation({
                ...booking,
                id: appointment.id  // Use DB ID
            }, hospital);

            // Clean up draft
            await BookingStateMachine.deleteDraft(bookingId);

            logger.info(`BookingService: Booking ${bookingId} confirmed as appointment ${appointment.id}`);

            return {
                success: true,
                appointment
            };

        } catch (err) {
            logger.error(`BookingService: Failed to confirm booking ${bookingId}`, err);
            return { success: false, error: 'Confirmation failed. Please try again.' };
        }
    }

    /**
     * Cancel a booking (before confirmation).
     * 
     * @param {string} bookingId - Booking ID
     * @param {string} sessionId - Session ID (for validation)
     * @param {string} reason - Cancellation reason
     * @returns {Promise<Object>} { success, error? }
     */
    static async cancelBooking(bookingId, sessionId, reason = 'User cancelled') {
        try {
            const booking = await BookingStateMachine.getBooking(bookingId);

            if (!booking) {
                return { success: false, error: 'Booking not found.' };
            }

            if (booking.sessionId !== sessionId) {
                return { success: false, error: 'Unauthorized.' };
            }

            if (BookingStateMachine.isTerminalState(booking.state)) {
                return { success: false, error: `Cannot cancel - booking is ${booking.state}.` };
            }

            // Cancel booking
            await BookingStateMachine.cancel(bookingId, reason);

            // Unlock slot
            await SlotService.unlockSlot(
                booking.hospitalId,
                booking.doctorId,
                booking.datetime,
                sessionId
            );

            // Invalidate OTP
            await OtpService.invalidateOtp(bookingId);

            // Clean up draft
            await BookingStateMachine.deleteDraft(bookingId);

            // Audit Log
            await AuditService.logBookingCancelled(booking.hospitalId, bookingId, 'system', reason);

            logger.info(`BookingService: Booking ${bookingId} cancelled`);

            return { success: true };

        } catch (err) {
            logger.error(`BookingService: Failed to cancel booking ${bookingId}`, err);
            return { success: false, error: 'Cancellation failed.' };
        }
    }

    /**
     * Get booking state and info.
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<Object|null>} Booking or null
     */
    static async getBookingStatus(bookingId) {
        return await BookingStateMachine.getBooking(bookingId);
    }
}

module.exports = { BookingService, BOOKING_STATES };
