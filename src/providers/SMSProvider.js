/**
 * SMSProvider - Base Interface
 * 
 * All SMS providers must implement this interface.
 * This ensures consistent behavior regardless of the underlying SMS service.
 * 
 * PHI SAFETY: Phone numbers are passed to provider but NEVER logged.
 * Logging must redact phone numbers using maskPhone() utility.
 */

class SMSProvider {
    /**
     * Send an SMS message.
     * 
     * @param {Object} params - Request parameters
     * @param {string} params.to - Recipient phone number (PHI - do not log)
     * @param {string} params.message - Message content
     * @param {string} params.senderId - Sender ID (alphanumeric or phone number)
     * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
     */
    async sendSMS({ to, message, senderId }) {
        throw new Error('SMSProvider.sendSMS() must be implemented by subclass');
    }

    /**
     * Get the provider name for logging purposes.
     * @returns {string}
     */
    getName() {
        return 'BaseSMSProvider';
    }

    /**
     * Check if the provider is properly configured.
     * @returns {boolean}
     */
    isConfigured() {
        return false;
    }

    /**
     * Mask phone number for safe logging.
     * Only shows last 4 digits.
     * 
     * @param {string} phone - Phone number to mask
     * @returns {string} Masked phone (e.g., "****5678")
     */
    maskPhone(phone) {
        if (!phone || phone.length < 4) return '****';
        return '****' + phone.slice(-4);
    }
}

module.exports = SMSProvider;
