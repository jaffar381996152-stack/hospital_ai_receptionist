/**
 * MockSMSProvider - Development/Testing Mock
 * 
 * Implements SMSProvider interface without actually sending SMS.
 * Used in development and testing environments.
 * 
 * PHI SAFETY: Logs masked phone numbers only.
 */

const SMSProvider = require('./SMSProvider');
const { logger } = require('../config/logger');

class MockSMSProvider extends SMSProvider {
    constructor() {
        super();
        this.sentMessages = []; // For test assertions
        logger.info('MockSMSProvider: Initialized (SMS will be mocked)');
    }

    /**
     * Mock SMS sending - logs but doesn't send.
     * 
     * @param {Object} params
     * @param {string} params.to - Recipient phone (PHI - masked in logs)
     * @param {string} params.message - Message content
     * @param {string} params.senderId - Sender ID
     * @returns {Promise<{success: boolean, messageId: string}>}
     */
    async sendSMS({ to, message, senderId }) {
        const mockId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Store for test assertions (with masked phone)
        this.sentMessages.push({
            id: mockId,
            to: this.maskPhone(to),
            senderId: senderId || 'MOCK',
            messagePreview: message.substring(0, 50) + '...',
            timestamp: new Date().toISOString()
        });

        logger.info(`[MockSMS] To: ${this.maskPhone(to)}, From: ${senderId || 'MOCK'}, Preview: ${message.substring(0, 30)}...`);

        return {
            success: true,
            messageId: mockId
        };
    }

    getName() {
        return 'MockSMSProvider';
    }

    isConfigured() {
        return true; // Always "configured" for dev
    }

    /**
     * Get sent messages (for testing).
     * @returns {Array} Array of sent message records
     */
    getSentMessages() {
        return this.sentMessages;
    }

    /**
     * Clear sent messages (for test cleanup).
     */
    clearSentMessages() {
        this.sentMessages = [];
    }
}

module.exports = MockSMSProvider;
