/**
 * OpenRouterProvider - OpenRouter API Implementation
 * 
 * Implements AIProvider interface for OpenRouter.ai service.
 * Supports multiple API keys with automatic rotation on failure.
 * 
 * PHI SAFETY: This provider ONLY receives sanitized (redacted) input.
 * The safety boundary is enforced by the AIService layer.
 */

const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const AIProvider = require('./AIProvider');
const { logger } = require('../config/logger');

// Configure Retry Logic (3 retries, exponential backoff)
axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
    }
});

class OpenRouterProvider extends AIProvider {
    constructor() {
        super();
        // Support multiple keys comma-separated
        const rawKeys = process.env.OPENROUTER_API_KEY || '';
        this.apiKeys = rawKeys.split(',').map(k => k.trim()).filter(k => k.length > 0);
        this.currentKeyIndex = 0;
        this.model = process.env.OPENROUTER_MODEL || 'arcee-ai/trinity-large-preview:free';
        this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';

        if (this.apiKeys.length === 0) {
            logger.warn('OpenRouterProvider: No API keys provided!');
        } else {
            logger.info(`OpenRouterProvider: Initialized with ${this.apiKeys.length} key(s), model: ${this.model}`);
        }
    }

    getName() {
        return 'openrouter';
    }

    isConfigured() {
        return this.apiKeys.length > 0;
    }

    getKey() {
        if (this.apiKeys.length === 0) return null;
        return this.apiKeys[this.currentKeyIndex];
    }

    rotateKey() {
        if (this.apiKeys.length <= 1) return false;
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        logger.warn(`OpenRouterProvider: Rotating API Key to index ${this.currentKeyIndex}`);
        return true;
    }

    /**
     * Generate response using OpenRouter API
     * 
     * @param {Object} params
     * @param {Array} params.messages - REDACTED conversation messages
     * @param {string} params.systemPrompt - System prompt
     * @param {Object} params.metadata - Additional metadata
     * @returns {Promise<{content: string, status: string}>}
     */
    async generateResponse({ messages, systemPrompt, metadata = {} }) {
        if (!this.isConfigured()) {
            logger.error('OpenRouterProvider: No API key configured');
            return {
                content: "I'm currently unavailable. Please try again later or call 9200-XXXXX.",
                status: 'error'
            };
        }

        // Build the full message array with system prompt
        const fullMessages = [
            { role: 'system', content: systemPrompt },
            ...messages
        ];

        let attempts = 0;
        const maxAttempts = this.apiKeys.length + 2; // All keys + 2 retries

        while (attempts < maxAttempts) {
            const currentKey = this.getKey();
            try {
                const response = await axios.post(this.apiUrl, {
                    model: this.model,
                    messages: fullMessages,
                    max_tokens: metadata.maxTokens || 150
                }, {
                    headers: {
                        'Authorization': `Bearer ${currentKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                });

                const content = response.data.choices[0].message.content;

                logger.info(`OpenRouterProvider: Response received (${content.length} chars)`);

                return {
                    content: content,
                    status: 'success'
                };

            } catch (error) {
                attempts++;
                logger.error(`OpenRouterProvider: Attempt ${attempts} failed: ${error.message}`);

                // Check for key rotation conditions (401 Unauthorized, 429 Rate Limit)
                if (error.response && (error.response.status === 401 || error.response.status === 429)) {
                    const rotated = this.rotateKey();
                    if (rotated) {
                        logger.warn(`OpenRouterProvider: Retrying with new key due to ${error.response.status}`);
                        continue;
                    }
                }

                // If out of retries, break
                if (attempts >= maxAttempts) break;
            }
        }

        // All attempts failed
        logger.error('OpenRouterProvider: All attempts exhausted');
        return {
            content: "I'm currently experiencing high traffic. Please try again in 1 minute or call 9200-XXXXX.",
            status: 'error'
        };
    }
}

module.exports = OpenRouterProvider;
