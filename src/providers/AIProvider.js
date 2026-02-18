/**
 * AIProvider - Base Interface
 * 
 * All AI providers must implement this interface.
 * This ensures consistent behavior regardless of the underlying AI service.
 * 
 * PHI SAFETY: Providers ONLY receive sanitized (redacted) input.
 * Raw user data NEVER reaches this layer.
 */

class AIProvider {
    /**
     * Generate a response from the AI model.
     * 
     * @param {Object} params - Request parameters
     * @param {Array<{role: string, content: string}>} params.messages - Conversation history (MUST be redacted)
     * @param {string} params.systemPrompt - System prompt for the AI
     * @param {Object} params.metadata - Additional metadata (language, context, etc.)
     * @returns {Promise<{content: string, status: 'success'|'error'}>}
     */
    async generateResponse({ messages, systemPrompt, metadata }) {
        throw new Error('AIProvider.generateResponse() must be implemented by subclass');
    }

    /**
     * Get the provider name for logging purposes.
     * @returns {string}
     */
    getName() {
        return 'BaseProvider';
    }

    /**
     * Check if the provider is properly configured.
     * @returns {boolean}
     */
    isConfigured() {
        return false;
    }
}

module.exports = AIProvider;
