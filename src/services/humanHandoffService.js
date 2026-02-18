/**
 * Human Handoff Service - Enterprise-Grade Escalation
 * 
 * PHASE 7: Enterprise human handoff with:
 * - Bilingual keyword detection (Arabic + English)
 * - Automatic escalation triggers (failures, frustration, low confidence)
 * - PHI-safe payload construction
 * - Per-hospital escalation channel routing
 * - AI disengagement enforcement
 * 
 * SAFETY RULES:
 * - NEVER include PHI in escalation payloads (no messages, names, phones, symptoms)
 * - ALWAYS set escalatedAt flag to prevent further AI calls
 * - ALWAYS log escalation events for audit compliance
 */

const { emailQueue } = require('../config/queue');
const { logger, auditLogger } = require('../config/logger');

/**
 * Trigger types for audit logging
 */
const TRIGGER_TYPES = {
    USER_REQUESTED: 'user_requested',
    AUTO_FAILURE: 'auto_failure',
    LOW_CONFIDENCE: 'low_confidence',
    FRUSTRATION: 'frustration'
};

/**
 * Default escalation configuration
 * Used when hospital config doesn't specify escalation_config
 */
const DEFAULT_ESCALATION_CONFIG = {
    channel: 'email',
    failure_threshold: 2,
    webhook_url: null,
    business_hours: '08:00-18:00',
    after_hours_channel: 'email'
};

/**
 * Bilingual handoff keywords
 * 
 * CRITICAL: These patterns detect user intent to speak with a human.
 * Language-aware detection ensures no user is blocked due to language.
 */
const HANDOFF_PATTERNS = {
    // English keywords
    english: /\b(human|agent|person|representative|staff|support|manager|operator|talk to someone|real person|call me|speak to someone|get me a human|i need a person)\b/i,

    // Arabic keywords (includes common variations)
    // شخص حقيقي = real person
    // إنسان = human
    // موظف = employee/staff
    // أريد التحدث مع = I want to talk to
    // اتصل بي = call me
    // ممثل = representative
    // مساعدة بشرية = human help
    arabic: /(شخص حقيقي|إنسان|موظف|أريد التحدث مع|اتصل بي|ممثل|مساعدة بشرية|تحدث مع شخص|أريد شخص|كلم حد|عايز اتكلم|ابي اكلم)/i
};

class HumanHandoffService {

    /**
     * Check if a message contains handoff request keywords.
     * 
     * LANGUAGE-AWARE: Detects both Arabic and English keywords.
     * 
     * @param {string} message - User's message (raw, not redacted)
     * @returns {boolean} - True if handoff requested
     */
    static isHandoffRequested(message) {
        if (!message || typeof message !== 'string') return false;

        // Check both language patterns
        const englishMatch = HANDOFF_PATTERNS.english.test(message);
        const arabicMatch = HANDOFF_PATTERNS.arabic.test(message);

        if (englishMatch || arabicMatch) {
            logger.info(`Handoff keyword detected: english=${englishMatch}, arabic=${arabicMatch}`);
        }

        return englishMatch || arabicMatch;
    }

    /**
     * Check if automatic escalation should be triggered.
     * 
     * AUTO-ESCALATION TRIGGERS:
     * 1. Consecutive AI failures >= threshold
     * 2. Repeated identical questions (frustration)
     * 3. Low confidence score (if available)
     * 
     * @param {Object} session - Express session object
     * @param {Object} aiResponse - Latest AI response (optional, for confidence check)
     * @param {Object} hospital - Hospital configuration
     * @returns {{shouldEscalate: boolean, triggerType: string|null}}
     */
    static checkAutoTrigger(session, aiResponse = null, hospital = null) {
        const config = hospital?.escalation_config || DEFAULT_ESCALATION_CONFIG;
        const threshold = config.failure_threshold || 2;

        // TRIGGER 1: Consecutive failures
        const failures = session.consecutiveErrors || 0;
        if (failures >= threshold) {
            logger.warn(`Auto-escalation trigger: ${failures} consecutive failures (threshold: ${threshold})`);
            return { shouldEscalate: true, triggerType: TRIGGER_TYPES.AUTO_FAILURE };
        }

        // TRIGGER 2: Low confidence (if AI provides it)
        if (aiResponse?.confidence !== undefined && aiResponse.confidence < 0.3) {
            logger.warn(`Auto-escalation trigger: Low confidence (${aiResponse.confidence})`);
            return { shouldEscalate: true, triggerType: TRIGGER_TYPES.LOW_CONFIDENCE };
        }

        // TRIGGER 3: Frustration detection (repeated questions)
        // Check last 4 user messages for repetition
        if (session.history && session.history.length >= 4) {
            const userMessages = session.history
                .filter(h => h.role === 'user')
                .slice(-4)
                .map(h => h.content?.toLowerCase().trim());

            // If 3+ of last 4 messages are similar, user is frustrated
            const uniqueMessages = new Set(userMessages);
            if (userMessages.length >= 3 && uniqueMessages.size <= 2) {
                logger.warn(`Auto-escalation trigger: Repeated questions detected (frustration)`);
                return { shouldEscalate: true, triggerType: TRIGGER_TYPES.FRUSTRATION };
            }
        }

        return { shouldEscalate: false, triggerType: null };
    }

    /**
     * Build PHI-safe escalation payload.
     * 
     * SAFETY: This payload is sent externally (email, webhook, ticket).
     * It MUST NOT contain any PHI:
     * - NO message content
     * - NO patient names
     * - NO phone numbers
     * - NO symptoms or medical info
     * 
     * @param {string} conversationId - Session/conversation ID
     * @param {string} hospitalId - Hospital identifier
     * @param {string} triggerType - Type of escalation trigger
     * @returns {Object} - Safe payload for external systems
     */
    static buildSafePayload(conversationId, hospitalId, triggerType) {
        // CRITICAL SAFETY: Only include non-PHI identifiers
        return {
            conversation_id: conversationId,
            hospital_id: hospitalId,
            reason: triggerType,
            timestamp: new Date().toISOString(),
            // Explicitly NOT including:
            // - user_message: NEVER
            // - patient_name: NEVER
            // - phone_number: NEVER
            // - symptoms: NEVER
        };
    }

    /**
     * Check if a session has been escalated (AI should be disengaged).
     * 
     * HARD RULE: Once escalated, AI must NOT be called again.
     * 
     * @param {Object} session - Express session object
     * @returns {boolean} - True if session is escalated
     */
    static isEscalated(session) {
        return session && session.escalatedAt !== undefined;
    }

    /**
     * Get the static response for escalated sessions.
     * 
     * This is the ONLY response given after escalation.
     * AI is NOT called.
     * 
     * @returns {Object} - Response object
     */
    static getEscalatedResponse() {
        return {
            reply: "A hospital representative will contact you shortly.",
            escalated: true
        };
    }

    /**
     * Route escalation to the appropriate channel.
     * 
     * CHANNEL TYPES:
     * - email: Queue email notification
     * - whatsapp_webhook: POST to webhook URL
     * - ticket_system: Create ticket (stub)
     * 
     * @param {Object} safePayload - PHI-safe payload
     * @param {Object} hospital - Hospital configuration
     * @returns {Promise<void>}
     */
    static async routeToChannel(safePayload, hospital) {
        const config = hospital?.escalation_config || DEFAULT_ESCALATION_CONFIG;
        const channel = this.getActiveChannel(config);

        logger.info(`Routing escalation via channel: ${channel} for hospital: ${hospital?.id || 'default'}`);

        switch (channel) {
            case 'email':
                await this.sendEmailNotification(safePayload, hospital);
                break;

            case 'whatsapp_webhook':
                await this.sendWebhookNotification(safePayload, config.webhook_url);
                break;

            case 'ticket_system':
                await this.createTicket(safePayload, hospital);
                break;

            default:
                logger.warn(`Unknown escalation channel: ${channel}, falling back to email`);
                await this.sendEmailNotification(safePayload, hospital);
        }
    }

    /**
     * Determine active channel based on business hours.
     * 
     * @param {Object} config - Escalation configuration
     * @returns {string} - Active channel name
     */
    static getActiveChannel(config) {
        if (!config.business_hours) return config.channel || 'email';

        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour * 60 + currentMinute;

        // Parse business hours (format: "08:00-18:00")
        const [startStr, endStr] = config.business_hours.split('-');
        if (!startStr || !endStr) return config.channel || 'email';

        const [startHour, startMin] = startStr.split(':').map(Number);
        const [endHour, endMin] = endStr.split(':').map(Number);
        const startTime = startHour * 60 + (startMin || 0);
        const endTime = endHour * 60 + (endMin || 0);

        const isBusinessHours = currentTime >= startTime && currentTime <= endTime;

        if (isBusinessHours) {
            return config.channel || 'email';
        } else {
            return config.after_hours_channel || config.channel || 'email';
        }
    }

    /**
     * Send email notification (via queue).
     * 
     * SAFETY: Only sends PHI-safe payload.
     */
    static async sendEmailNotification(safePayload, hospital) {
        try {
            await emailQueue.add('escalation-email', {
                details: {
                    name: 'Human Handoff Request',
                    department: 'Reception Escalation',
                    date: safePayload.timestamp.split('T')[0],
                    time: new Date(safePayload.timestamp).toLocaleTimeString(),
                    // SAFETY: Only reference IDs, not content
                    patient_summary: `Conversation ${safePayload.conversation_id} requires human assistance. Reason: ${safePayload.reason}. Hospital: ${hospital?.name || 'Unknown'}`
                },
                hospitalId: safePayload.hospital_id
            });
            logger.info(`Escalation email queued for conversation: ${safePayload.conversation_id}`);
        } catch (err) {
            logger.error('Failed to queue escalation email', err);
        }
    }

    /**
     * Send webhook notification (for WhatsApp Business API, etc.).
     * 
     * SAFETY: Only sends PHI-safe payload.
     * STUB: Actual HTTP call would go here.
     */
    static async sendWebhookNotification(safePayload, webhookUrl) {
        if (!webhookUrl) {
            logger.warn('WhatsApp webhook URL not configured, skipping');
            return;
        }

        // STUB: In production, this would make an HTTP POST
        // const response = await axios.post(webhookUrl, safePayload);
        logger.info(`[STUB] Would POST to webhook: ${webhookUrl}`);
        logger.info(`[STUB] Payload: ${JSON.stringify(safePayload)}`);
    }

    /**
     * Create ticket in ticket system.
     * 
     * SAFETY: Only sends PHI-safe payload.
     * STUB: Actual ticket API call would go here.
     */
    static async createTicket(safePayload, hospital) {
        // STUB: In production, this would call ticket system API
        logger.info(`[STUB] Would create ticket for hospital: ${hospital?.id}`);
        logger.info(`[STUB] Ticket data: ${JSON.stringify(safePayload)}`);
    }

    /**
     * Trigger human handoff workflow.
     * 
     * COMPLETE WORKFLOW:
     * 1. Mark session as escalated (disengages AI)
     * 2. Build PHI-safe payload
     * 3. Route to appropriate channel
     * 4. Log audit event
     * 5. Return confirmation to user
     * 
     * @param {string} sessionId - Session/conversation ID
     * @param {string} reason - Human-readable reason
     * @param {Object} hospital - Hospital configuration
     * @param {Object} session - Express session object (to set escalatedAt)
     * @param {string} triggerType - Trigger type for audit (default: user_requested)
     * @returns {Promise<Object>} - Response object for user
     */
    static async triggerHandoff(sessionId, reason = 'User Request', hospital = null, session = null, triggerType = TRIGGER_TYPES.USER_REQUESTED) {
        logger.info(`Human handoff triggered: session=${sessionId}, reason=${reason}, trigger=${triggerType}`);

        // STEP 1: Mark session as escalated (HARD AI DISENGAGEMENT)
        if (session) {
            session.escalatedAt = Date.now();
            session.escalationReason = reason;
            logger.info(`Session ${sessionId} marked as escalated at ${session.escalatedAt}`);
        }

        // Get hospital info
        let hospitalId = 'default';
        let hospitalName = 'Hospital';

        if (hospital) {
            hospitalId = hospital.id || 'default';
            hospitalName = hospital.name || 'Hospital';
        } else {
            // Backward compatibility: Try legacy file
            try {
                const hospitalInfo = require('../../data/hospital-info.json');
                hospitalName = hospitalInfo.name || 'Hospital';
            } catch (e) {
                logger.warn('Could not load hospital-info.json for escalation');
            }
        }

        // STEP 2: Build PHI-safe payload
        const safePayload = this.buildSafePayload(sessionId, hospitalId, triggerType);

        // STEP 3: Route to channel
        await this.routeToChannel(safePayload, hospital);

        // STEP 4: Audit log (COMPLIANCE REQUIREMENT)
        auditLogger.info({
            action: 'HUMAN_HANDOFF',
            hospital_id: hospitalId,
            conversationId: sessionId,
            actor: 'system',
            data: {
                reason,
                trigger_type: triggerType,
                hospital_name: hospitalName
            }
        });

        // STEP 5: Return confirmation
        const contactInfo = hospital?.escalation_contact;
        const contactMsg = contactInfo?.phone ? ` at ${contactInfo.phone}` : '';

        return {
            reply: `I understand you'd like to speak with a human representative. I have forwarded your request to our staff at ${hospitalName}. A hospital representative will contact you shortly${contactMsg}.`,
            escalated: true
        };
    }
}

// Export trigger types for external use
HumanHandoffService.TRIGGER_TYPES = TRIGGER_TYPES;

module.exports = HumanHandoffService;
