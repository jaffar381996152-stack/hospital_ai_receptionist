/**
 * Escalation Service - Human Handoff
 * 
 * MULTI-TENANT: Uses hospital-specific escalation contacts.
 * 
 * Triggers a human handoff workflow with hospital-aware routing.
 */

const { emailQueue } = require('../config/queue');
const { logger, auditLogger } = require('../config/logger');

class EscalationService {

    /**
     * Triggers a human handoff workflow.
     * 
     * MULTI-TENANT: Uses hospital-specific escalation contacts.
     * 
     * @param {string} sessionId - User's session ID
     * @param {string} reason - Reason for handoff (e.g., "User Request", "Low Confidence")
     * @param {Object} hospital - Hospital configuration object (REQUIRED for multi-tenant)
     * @returns {Promise<object>} - Response object to send to the user
     */
    static async triggerHandoff(sessionId, reason = 'User Request', hospital = null) {
        logger.info(`Escalation triggered for Session ${sessionId} (${reason})`);

        // MULTI-TENANT: Use hospital-specific escalation contacts
        let contactInfo = { email: 'admin@hospital.com', phone: 'the administration' };
        let hospitalId = 'default';
        let hospitalName = 'Hospital';

        if (hospital) {
            hospitalId = hospital.id || 'default';
            hospitalName = hospital.name || 'Hospital';

            if (hospital.escalation_contact) {
                contactInfo = hospital.escalation_contact;
            }
        } else {
            // Fallback: Try to load from legacy file (backward compatibility)
            try {
                const hospitalInfo = require('../../data/hospital-info.json');
                if (hospitalInfo.escalation_contact) {
                    contactInfo = hospitalInfo.escalation_contact;
                }
            } catch (e) {
                logger.warn('Could not load hospital-info.json for escalation details');
            }
        }

        // 1. Audit Log (Strict Compliance: Log event, NO clinical data)
        // MULTI-TENANT: Include hospital_id in audit
        auditLogger.info({
            action: 'HUMAN_HANDOFF',
            hospital_id: hospitalId,
            conversationId: sessionId,
            actor: 'system',
            data: { reason, hospital_name: hospitalName }
        });

        // 2. Queue Email Notification
        // Note: For privacy, we do NOT send the chat history in email yet.
        // Just a notification that ID XYZ needs help.
        try {
            await emailQueue.add('escalation-email', {
                details: {
                    name: 'Escalation Alert',
                    department: 'Reception Admin',
                    date: new Date().toISOString().split('T')[0],
                    time: new Date().toLocaleTimeString(),
                    patient_summary: `User (Session: ${sessionId}) at ${hospitalName} requested human assistance. Reason: ${reason}. Please contact ${contactInfo.phone} or check dashboard.`
                }
            });
        } catch (err) {
            logger.error('Failed to queue escalation email', err);
            // Continue even if email fails, so user gets the reply
        }

        // 3. Return Standard Response (with hospital-specific contact)
        const contactMsg = contactInfo.phone ? ` at ${contactInfo.phone}` : '';
        return {
            reply: `I understand you'd like to speak with a human agent at ${hospitalName}. I have forwarded your request to our staff. Someone will review your case and contact you shortly${contactMsg}. Is there anything else I can help with in the meantime?`
        };
    }

    /**
     * Checks if a message contains explicit handoff keywords
     * @param {string} message 
     * @returns {boolean}
     */
    static isHandoffRequested(message) {
        if (!message) return false;
        const pattern = /\b(human|agent|person|representative|staff|support|manager|operator|talk to someone)\b/i;
        return pattern.test(message);
    }
}

module.exports = EscalationService;
