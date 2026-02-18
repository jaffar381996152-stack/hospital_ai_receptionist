/**
 * Booking Notification Service - Phase 4
 * 
 * Sends notifications when booking is confirmed:
 * - SMS to patient
 * - Email to hospital
 * 
 * Uses queues for reliable delivery.
 */

const { emailQueue, smsQueue } = require('../config/queue');
const { logger, auditLogger } = require('../config/logger');

class BookingNotificationService {

    /**
     * Send all confirmation notifications.
     * 
     * @param {Object} booking - Booking data
     * @param {Object} hospital - Hospital config
     * @returns {Promise<Object>} { smsQueued: boolean, emailQueued: boolean }
     */
    static async notifyConfirmation(booking, hospital) {
        const results = {
            smsQueued: false,
            emailQueued: false
        };

        try {
            // Queue SMS to patient
            results.smsQueued = await this.queuePatientSms(booking, hospital);
        } catch (err) {
            logger.error('BookingNotification: Failed to queue SMS', err);
        }

        try {
            // Queue email to hospital
            results.emailQueued = await this.queueHospitalEmail(booking, hospital);
        } catch (err) {
            logger.error('BookingNotification: Failed to queue email', err);
        }

        auditLogger.info({
            action: 'BOOKING_NOTIFICATIONS_QUEUED',
            hospital_id: booking.hospitalId,
            actor: 'system',
            data: {
                booking_id: booking.id,
                sms_queued: results.smsQueued,
                email_queued: results.emailQueued
            }
        });

        return results;
    }

    /**
     * Queue SMS confirmation to patient.
     * 
     * PHASE 5: Includes per-hospital Sender ID.
     * 
     * @param {Object} booking - Booking data
     * @param {Object} hospital - Hospital config
     * @returns {Promise<boolean>} Success
     */
    static async queuePatientSms(booking, hospital) {
        if (!booking.patientPhone) {
            logger.warn('BookingNotification: No phone number for SMS');
            return false;
        }

        // Check if SMS is enabled for this hospital
        if (hospital.sms_config?.enabled === false) {
            logger.info(`BookingNotification: SMS disabled for hospital ${hospital.id}`);
            return false;
        }

        const message = this.formatPatientSms(booking, hospital);
        const senderId = hospital.sms_config?.sender_id || hospital.name?.substring(0, 11) || 'HOSPITAL';

        await smsQueue.add('booking-confirmation-sms', {
            to: booking.patientPhone,
            message: message,
            senderId: senderId,
            bookingId: booking.id,
            hospitalId: booking.hospitalId
        }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            }
        });

        logger.info(`BookingNotification: SMS queued for booking ${booking.id}`);
        return true;
    }

    /**
     * Queue email to hospital.
     * 
     * @param {Object} booking - Booking data
     * @param {Object} hospital - Hospital config
     * @returns {Promise<boolean>} Success
     */
    static async queueHospitalEmail(booking, hospital) {
        const email = hospital.contact_email || hospital.escalation_contact?.email;

        if (!email) {
            logger.warn('BookingNotification: No hospital email configured');
            return false;
        }

        const emailData = this.formatHospitalEmail(booking, hospital);

        await emailQueue.add('booking-confirmation-email', {
            to: email,
            subject: emailData.subject,
            html: emailData.html,
            bookingId: booking.id,
            hospitalId: booking.hospitalId
        }, {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 2000
            }
        });

        logger.info(`BookingNotification: Email queued for booking ${booking.id}`);
        return true;
    }

    /**
     * Format SMS message for patient.
     * 
     * @param {Object} booking - Booking data
     * @param {Object} hospital - Hospital config
     * @returns {string} SMS text
     */
    static formatPatientSms(booking, hospital) {
        const date = new Date(booking.datetime);
        const dateStr = date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
        const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        return `✅ Booking Confirmed!\n\n` +
            `${hospital.name}\n` +
            `📅 ${dateStr} at ${timeStr}\n` +
            `🏥 Dr. ID: ${booking.doctorId}\n\n` +
            `Booking ID: ${booking.id}\n\n` +
            `Please arrive 15 minutes early.\n` +
            `To cancel, reply CANCEL ${booking.id}`;
    }

    /**
     * Format email for hospital.
     * 
     * @param {Object} booking - Booking data
     * @param {Object} hospital - Hospital config
     * @returns {Object} { subject, html }
     */
    static formatHospitalEmail(booking, hospital) {
        const date = new Date(booking.datetime);
        const dateStr = date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        const subject = `New Booking Confirmed - ${booking.id}`;

        const html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; }
        .booking-id { font-size: 24px; font-weight: bold; color: #2563eb; }
        .detail { margin: 10px 0; }
        .label { font-weight: bold; color: #64748b; }
        .value { color: #1e293b; }
        .footer { background: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 style="margin: 0;">✅ New Booking Confirmed</h1>
        </div>
        <div class="content">
            <p class="booking-id">${booking.id}</p>
            
            <div class="detail">
                <span class="label">Date:</span>
                <span class="value">${dateStr}</span>
            </div>
            
            <div class="detail">
                <span class="label">Time:</span>
                <span class="value">${timeStr}</span>
            </div>
            
            <div class="detail">
                <span class="label">Doctor ID:</span>
                <span class="value">${booking.doctorId}</span>
            </div>
            
            <div class="detail">
                <span class="label">Patient:</span>
                <span class="value">${booking.patientName || 'Not provided'}</span>
            </div>
            
            <div class="detail">
                <span class="label">Phone:</span>
                <span class="value">${booking.patientPhone ? '****' + booking.patientPhone.slice(-4) : 'Not provided'}</span>
            </div>
            
            <div class="detail">
                <span class="label">Email:</span>
                <span class="value">${booking.patientEmail || 'Not provided'}</span>
            </div>
            
            <div class="detail">
                <span class="label">Confirmed At:</span>
                <span class="value">${new Date().toISOString()}</span>
            </div>
        </div>
        <div class="footer">
            ${hospital.name} - AI Receptionist System<br>
            This is an automated notification.
        </div>
    </div>
</body>
</html>
        `.trim();

        return { subject, html };
    }

    /**
     * Send cancellation notifications.
     * 
     * @param {Object} booking - Booking data
     * @param {Object} hospital - Hospital config
     * @param {string} reason - Cancellation reason
     */
    static async notifyCancellation(booking, hospital, reason = 'User cancelled') {
        try {
            if (booking.patientPhone) {
                await smsQueue.add('booking-cancellation-sms', {
                    to: booking.patientPhone,
                    message: `❌ Your booking ${booking.id} at ${hospital.name} has been cancelled.\n\nReason: ${reason}\n\nPlease contact us to reschedule.`,
                    bookingId: booking.id
                });
            }

            logger.info(`BookingNotification: Cancellation notification queued for ${booking.id}`);
        } catch (err) {
            logger.error('BookingNotification: Failed to queue cancellation', err);
        }
    }
}

module.exports = BookingNotificationService;
