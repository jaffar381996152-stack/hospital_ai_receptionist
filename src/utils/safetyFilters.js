const { logger } = require('../config/logger');

// Lightweight list of common drugs/classes (expandable)
const DRUG_LIST = [
    'ibuprofen', 'aspirin', 'paracetamol', 'panadol', 'tylenol', 'advil',
    'antibiotic', 'amoxicillin', 'penicillin', 'ciprofloxacin', 'azithromycin',
    'metformin', 'insulin', 'statin', 'lipitor', 'xanax', 'valium', 'morphine',
    'adderall', 'ritalin', 'viagra', 'cialis', 'steroid', 'prednisone'
];

// Patterns implicating advice
const ADVICE_PATTERNS = [
    /\b(take|use|apply|buy|drink|swallow|inject|prescribe|order)\s+([a-z]+)/i,
    /\b(you should|you need to)\s+(take|buy|use)/i,
    /\b(treatment|cure|remedy)\s+for/i,
    /\b(dose|dosage|mg|milligrams)\b/i
];

class SafetyFilter {

    /**
     * Scans AI output for medical advice or drug mentions.
     * @param {string} text 
     * @returns {string} Safe text (redacted if necessary)
     */
    static scanAndSanitize(text) {
        let cleanText = text;
        let violationDetected = false;

        // 1. Check Drug Names
        const lowerText = text.toLowerCase();
        for (const drug of DRUG_LIST) {
            if (lowerText.includes(drug)) {
                logger.warn(`SAFETY: Redacted drug name '${drug}'`, { audit: true, type: 'SAFETY_VIOLATION' });
                violationDetected = true;
                // Redact the specific word (simple approach) or genericize
                const reg = new RegExp(`\\b${drug}\\b`, 'gi');
                cleanText = cleanText.replace(reg, '[MEDICAL_ADVICE_REDACTED]');
            }
        }

        // 2. Check Advice Patterns
        for (const pattern of ADVICE_PATTERNS) {
            if (pattern.test(cleanText)) {
                logger.warn(`SAFETY: Advice pattern detected`, { audit: true, type: 'SAFETY_VIOLATION', pattern: pattern.toString() });
                violationDetected = true;
                cleanText = "I cannot provide specific medical treatments or medication advice. Please consult a doctor for a proper diagnosis and prescription.";
                break; // Stop after finding one block-level violation
            }
        }

        // 3. Inject Disclaimer if generic medical keywords exist but no violation
        const medicalContextKeywords = ['pain', 'doctor', 'hospital', 'symptom', 'emergency', 'ache'];
        if (medicalContextKeywords.some(k => lowerText.includes(k)) && !cleanText.includes('This system does not')) {
            cleanText += "\n\n_(Disclaimer: This system does not provide medical diagnosis. For emergencies, contact emergency services immediately.)_";
        }

        return cleanText;
    }
}

module.exports = SafetyFilter;
