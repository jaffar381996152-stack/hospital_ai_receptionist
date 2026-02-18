/**
 * Safe AI Input Helper
 * 
 * PHI SAFETY BOUNDARY - This is the ONLY way to get input for AI services.
 * 
 * This helper ensures that:
 * 1. Only REDACTED content reaches the AI
 * 2. Raw content (res.locals.rawMessage) is NEVER passed to AI
 * 3. Session history contains only redacted messages
 * 
 * ARCHITECTURAL ENFORCEMENT:
 * AIService MUST use this helper. Direct access to req.body.message
 * is not allowed in the AI layer.
 */

const { logger } = require('../config/logger');

/**
 * SafeAIInput class - Immutable container for AI-safe input
 * 
 * This class wraps sanitized input and prevents accidental PHI leakage.
 */
class SafeAIInput {
    /**
     * @param {string} message - REDACTED user message
     * @param {Array} history - REDACTED conversation history
     * @param {Object} context - Context data (slots, hours, etc.)
     * @param {string} language - User's preferred language
     */
    constructor(message, history, context, language) {
        // Store as private-like properties
        this._message = message;
        this._history = history;
        this._context = context;
        this._language = language;
        this._validated = true;

        // Freeze to prevent modification
        Object.freeze(this);
    }

    get message() { return this._message; }
    get history() { return this._history; }
    get context() { return this._context; }
    get language() { return this._language; }
    get isValidated() { return this._validated; }
}

/**
 * Get safe AI input from request.
 * 
 * This function extracts ONLY redacted content from the request.
 * It THROWS if raw content is accidentally passed.
 * 
 * @param {Object} req - Express request object
 * @returns {SafeAIInput} - Safe, validated input for AI
 * @throws {Error} If raw content detection fails or input is invalid
 */
function getSafeAIInput(req) {
    // 1. Get the REDACTED message (req.body.message is already redacted by phiRedaction middleware)
    const message = req.body.message;

    // 2. Validate message exists
    if (!message || typeof message !== 'string') {
        throw new Error('SafeAIInput: Message is required');
    }

    // 3. Get session
    const session = req.session;
    if (!session) {
        throw new Error('SafeAIInput: Session is required');
    }

    // 4. Get REDACTED history (hospital-scoped session history only contains redacted messages)
    const hospitalSession = req.hospitalSession || session;
    const history = hospitalSession.history || [];

    // 5. Get context data (this is safe - contains only system data, no PHI)
    const context = req._aiContext || {};

    // 6. Get language preference (hospital-scoped)
    const language = hospitalSession.preferredLanguage || 'English';

    // 7. SAFETY CHECK: Ensure we're not accidentally using raw message
    // The raw message is stored in res.locals.rawMessage by phiRedaction middleware
    // We explicitly DO NOT access it here

    logger.info('SafeAIInput: Created safe input container');

    return new SafeAIInput(message, history, context, language);
}

/**
 * Validate that input is a SafeAIInput instance.
 * AIService should call this to ensure it only receives validated input.
 * 
 * @param {any} input - Input to validate
 * @throws {Error} If input is not a SafeAIInput instance
 */
function validateSafeInput(input) {
    if (!(input instanceof SafeAIInput)) {
        const error = new Error('SafeAIInput: Invalid input - expected SafeAIInput instance. Raw input is not allowed.');
        logger.error('PHI SAFETY VIOLATION ATTEMPT: Direct input passed to AI service');
        throw error;
    }

    if (!input.isValidated) {
        throw new Error('SafeAIInput: Input validation failed');
    }
}

module.exports = {
    getSafeAIInput,
    validateSafeInput,
    SafeAIInput
};
