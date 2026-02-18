const { logger } = require('../config/logger');

class TriageService {
    constructor() {
        // 1. Emergency Red Flags (Regex Patterns)
        this.emergencyPatterns = [
            /\b(chest pain|heart attack|cardiac arrest)\b/i,
            /\b(severe bleeding|uncontrolled bleeding|hemorrhage)\b/i,
            /\b(difficulty breathing|shortness of breath|can't breathe|choking)\b/i,
            /\b(stroke|slurred speech|face drooping|numbness in arm)\b/i,
            /\b(loss of consciousness|passed out|fainted)\b/i,
            /\b(anaphylaxis|swollen tongue|swollen throat)\b/i,
            /\b(head trauma|severe head injury)\b/i,
            /\b(overdose|poisoning)\b/i,
            /\b(suicidal|kill myself|hurt myself)\b/i,
            /\b(seizure|convulsing)\b/i
        ];

        // 2. Department Keywords (Fallback Routing)
        this.deptPatterns = {
            'Cardiology': [/\b(heart|palpitations|blood pressure)\b/i],
            'Dentistry': [/\b(tooth|teeth|gum|jaw|molar|cavity)\b/i],
            'Dermatology': [/\b(skin|rash|acne|mole|dermatitis)\b/i],
            'Orthopedics': [/\b(bone|fracture|joint|knee|back pain|spine)\b/i],
            'Pediatrics': [/\b(child|baby|kid|infant|fever)\b/i],
            'General Medicine': [/\b(sick|cold|flu|infection|fever|cough)\b/i]
        };
    }

    /**
     * Assess the message for emergency or routing.
     * @param {string} message 
     * @returns {Object} { status: 'emergency'|'routine'|'unknown', response: string|null, department: string|null }
     */
    evaluate(message) {
        if (!message) return { status: 'unknown', response: null };

        // Check Emergencies First
        for (const pattern of this.emergencyPatterns) {
            if (pattern.test(message)) {
                logger.warn(`Emergency Detected: "${message}"`);
                return {
                    status: 'emergency',
                    response: "⚠️ **URGENT MEDICAL WARNING** ⚠️\n\nYour symptoms may indicate a life-threatening emergency.\n\nPLEASE CALL EMERGENCY SERVICES (997) OR VISIT THE NEAREST ER IMMEDIATELY.\n\nDo NOT wait for an appointment."
                };
            }
        }

        // Check Department Routing
        for (const [dept, patterns] of Object.entries(this.deptPatterns)) {
            if (patterns.some(p => p.test(message))) {
                return { status: 'routine', department: dept };
            }
        }

        return { status: 'unknown' };
    }
}

module.exports = new TriageService();
