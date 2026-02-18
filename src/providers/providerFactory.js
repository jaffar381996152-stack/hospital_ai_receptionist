/**
 * Provider Factory
 * 
 * Factory for creating AI provider instances based on environment configuration.
 * Reads AI_PROVIDER env variable and returns the appropriate provider.
 * 
 * Supported providers:
 *   - openrouter (default)
 *   - openai
 * 
 * Usage:
 *   const provider = require('./providerFactory');
 *   const response = await provider.generateResponse({...});
 */

const { logger } = require('../config/logger');

// Valid provider names
const VALID_PROVIDERS = ['openrouter', 'openai'];

/**
 * Create and return the configured AI provider instance.
 * This is called once at module load time.
 * 
 * @throws {Error} If AI_PROVIDER is set to an invalid value
 * @returns {AIProvider}
 */
function createProvider() {
    const providerName = (process.env.AI_PROVIDER || 'openrouter').toLowerCase().trim();

    // Validate provider name
    if (!VALID_PROVIDERS.includes(providerName)) {
        const errorMsg = `Invalid AI_PROVIDER: "${providerName}". Valid options: ${VALID_PROVIDERS.join(', ')}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }

    let provider;

    switch (providerName) {
        case 'openrouter':
            const OpenRouterProvider = require('./OpenRouterProvider');
            provider = new OpenRouterProvider();
            break;

        case 'openai':
            const OpenAIProvider = require('./OpenAIProvider');
            provider = new OpenAIProvider();
            break;

        default:
            // This should never be reached due to validation above
            throw new Error(`Unhandled provider: ${providerName}`);
    }

    logger.info(`AI Provider Factory: Created provider = ${provider.getName()}`);

    return provider;
}

// Export singleton instance
module.exports = createProvider();
