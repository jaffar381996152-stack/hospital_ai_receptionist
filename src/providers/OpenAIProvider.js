/**
 * OpenAIProvider - OpenAI API Implementation (STUB)
 * 
 * Implements AIProvider interface for OpenAI API.
 * This is a production-ready stub that can be activated by setting:
 *   AI_PROVIDER=openai
 *   OPENAI_API_KEY=sk-...
 * 
 * PHI SAFETY: This provider ONLY receives sanitized (redacted) input.
 * The safety boundary is enforced by the AIService layer.
 */

const AIProvider = require('./AIProvider');
const { logger } = require('../config/logger');

class OpenAIProvider extends AIProvider {
    constructor() {
        super();
        this.apiKey = process.env.OPENAI_API_KEY || '';
        this.model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
        this.apiUrl = 'https://api.openai.com/v1/chat/completions';

        if (!this.apiKey) {
            logger.warn('OpenAIProvider: No API key provided - provider inactive');
        } else {
            logger.info(`OpenAIProvider: Initialized with model: ${this.model}`);
        }
    }

    getName() {
        return 'openai';
    }

    isConfigured() {
        return this.apiKey.length > 0;
    }

    /**
     * Generate response using OpenAI API
     * 
     * @param {Object} params
     * @param {Array} params.messages - REDACTED conversation messages
     * @param {string} params.systemPrompt - System prompt
     * @param {Object} params.metadata - Additional metadata
     * @returns {Promise<{content: string, status: string}>}
     */
    async generateResponse({ messages, systemPrompt, metadata = {} }) {
        // If not configured, return a safe fallback message
        if (!this.isConfigured()) {
            logger.warn('OpenAIProvider: Inactive - no API key. Returning fallback.');
            return {
                content: "The AI service is currently unavailable. Please try again later or call 9200-XXXXX for assistance.",
                status: 'error'
            };
        }

        // Build the full message array with system prompt
        const fullMessages = [
            { role: 'system', content: systemPrompt },
            ...messages
        ];

        try {
            // NOTE: When activating this provider, uncomment axios import and use real API call
            // const axios = require('axios');
            // const response = await axios.post(this.apiUrl, {
            //     model: this.model,
            //     messages: fullMessages,
            //     max_tokens: metadata.maxTokens || 150
            // }, {
            //     headers: {
            //         'Authorization': `Bearer ${this.apiKey}`,
            //         'Content-Type': 'application/json'
            //     },
            //     timeout: 30000
            // });
            // 
            // return {
            //     content: response.data.choices[0].message.content,
            //     status: 'success'
            // };

            // STUB: For now, return a placeholder response
            logger.info('OpenAIProvider: Stub mode - returning mock response');
            return {
                content: "[OpenAI Stub Response] This provider is configured but running in stub mode. Set OPENAI_API_KEY and uncomment the API call to activate.",
                status: 'success'
            };

        } catch (error) {
            logger.error(`OpenAIProvider: API call failed: ${error.message}`);
            return {
                content: "I'm currently experiencing issues. Please try again later or call 9200-XXXXX.",
                status: 'error'
            };
        }
    }
}

module.exports = OpenAIProvider;
