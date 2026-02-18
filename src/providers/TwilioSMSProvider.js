/**
 * TwilioSMSProvider - Twilio Implementation
 * 
 * Implements SMSProvider interface using Twilio API.
 * 
 * Configuration:
 * - TWILIO_ACCOUNT_SID: Twilio account SID
 * - TWILIO_AUTH_TOKEN: Twilio auth token
 * - TWILIO_DEFAULT_FROM: Default sender (fallback if no hospital senderId)
 * 
 * PHI SAFETY: Phone numbers are NEVER logged.
 */

const SMSProvider = require('./SMSProvider');
const { logger } = require('../config/logger');

class TwilioSMSProvider extends SMSProvider {
    constructor() {
        super();
        this.accountSid = process.env.TWILIO_ACCOUNT_SID;
        this.authToken = process.env.TWILIO_AUTH_TOKEN;
        this.defaultFrom = process.env.TWILIO_DEFAULT_FROM || 'HOSPITAL';
        this.client = null;

        if (this.isConfigured()) {
            try {
                // Lazy-load Twilio to avoid issues if not installed
                const twilio = require('twilio');
                this.client = twilio(this.accountSid, this.authToken);
                logger.info('TwilioSMSProvider: Initialized successfully');
            } catch (err) {
                logger.error('TwilioSMSProvider: Failed to initialize Twilio client', err.message);
            }
        } else {
            logger.warn('TwilioSMSProvider: Not configured (missing credentials)');
        }
    }

    /**
     * Send SMS via Twilio.
     * 
     * @param {Object} params
     * @param {string} params.to - Recipient phone (PHI)
     * @param {string} params.message - Message content
     * @param {string} params.senderId - Hospital-specific sender ID
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     */
    async sendSMS({ to, message, senderId }) {
        if (!this.client) {
            return {
                success: false,
                error: 'Twilio client not initialized'
            };
        }

        try {
            const result = await this.client.messages.create({
                body: message,
                from: senderId || this.defaultFrom,
                to: to
            });

            logger.info(`TwilioSMSProvider: SMS sent to ${this.maskPhone(to)}, SID: ${result.sid}`);

            return {
                success: true,
                messageId: result.sid
            };
        } catch (err) {
            // PHI-safe logging: never log the phone number
            logger.error(`TwilioSMSProvider: Failed to send SMS to ${this.maskPhone(to)}`, {
                error: err.message,
                code: err.code,
                // Do NOT log: to, message content
            });

            return {
                success: false,
                error: err.message
            };
        }
    }

    getName() {
        return 'TwilioSMSProvider';
    }

    isConfigured() {
        return !!(this.accountSid && this.authToken);
    }
}

module.exports = TwilioSMSProvider;
