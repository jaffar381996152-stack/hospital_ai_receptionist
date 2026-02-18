/**
 * SMS Provider Factory
 * 
 * Creates the appropriate SMS provider based on configuration.
 * 
 * Configuration:
 * - ENABLE_SMS_TRANSPORT=true -> TwilioSMSProvider
 * - Otherwise -> MockSMSProvider
 */

const { logger } = require('../config/logger');

let smsProviderInstance = null;

/**
 * Get the configured SMS provider (singleton).
 * 
 * @returns {SMSProvider} The SMS provider instance
 */
function getSMSProvider() {
    if (smsProviderInstance) {
        return smsProviderInstance;
    }

    const enableSMS = process.env.ENABLE_SMS_TRANSPORT === 'true';

    if (enableSMS) {
        const TwilioSMSProvider = require('./TwilioSMSProvider');
        smsProviderInstance = new TwilioSMSProvider();

        if (!smsProviderInstance.isConfigured()) {
            logger.warn('SMSProviderFactory: Twilio enabled but not configured, falling back to Mock');
            const MockSMSProvider = require('./MockSMSProvider');
            smsProviderInstance = new MockSMSProvider();
        }
    } else {
        const MockSMSProvider = require('./MockSMSProvider');
        smsProviderInstance = new MockSMSProvider();
    }

    logger.info(`SMSProviderFactory: Using ${smsProviderInstance.getName()}`);
    return smsProviderInstance;
}

/**
 * Reset the provider instance (for testing).
 */
function resetSMSProvider() {
    smsProviderInstance = null;
}

module.exports = {
    getSMSProvider,
    resetSMSProvider
};
