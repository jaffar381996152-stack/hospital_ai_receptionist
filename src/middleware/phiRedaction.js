const { logger, auditLogger } = require('../config/logger');

/**
 * PHI/PII Redaction Middleware
 * Redacts sensitive information before it reaches external AI services.
 * Keeps the original message in `req.local.rawMessage` for internal Triage.
 */
const redactPhi = (req, res, next) => {
    try {
        if (!req.body || !req.body.message) {
            return next();
        }

        const originalMessage = req.body.message;

        // Store raw message in res.locals (Standard Express pattern)
        res.locals.rawMessage = originalMessage;

        let redactedMessage = originalMessage;
        let redactionCount = 0;

        // 1. Redact Emails
        // Pattern: simple email regex
        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
        if (emailRegex.test(redactedMessage)) {
            redactedMessage = redactedMessage.replace(emailRegex, '[EMAIL_REDACTED]');
            redactionCount++;
        }

        // 2. Redact Saudi Phone Numbers (and general formats)
        // Saudi Mobile: 05x xxx xxxx, +966 5x xxx xxxx
        // General: simple patterns for demo purposes
        const phoneRegex = /\b(\+966\s?5\d{8}|05\d{8})\b/g;
        // Also catch generic 10 digit numbers that look like phones if not caught above
        const genericPhoneRegex = /\b\d{10}\b/g;

        if (phoneRegex.test(redactedMessage)) {
            redactedMessage = redactedMessage.replace(phoneRegex, '[PHONE_NUMBER]');
            redactionCount++;
        }

        // 3. Redact National IDs / MRN (Saudi National ID is 10 digits starting with 1 or 2)
        // We need to be careful not to double redact if phone regex caught it.
        // Let's assume specific context or 10 digits that didn't match phone.
        const idRegex = /\b[12]\d{9}\b/g;
        if (idRegex.test(redactedMessage)) {
            redactedMessage = redactedMessage.replace(idRegex, '[NATIONAL_ID]');
            redactionCount++;
        }

        // 4. Redact Names (Heuristic based)
        // Patterns: "My name is X", "I am X", "Name: X"
        const namePatterns = [
            /(?<=my name is\s)([A-Z][a-z]+(\s[A-Z][a-z]+)?)/gi,
            /(?<=i am\s)([A-Z][a-z]+(\s[A-Z][a-z]+)?)/gi,
            /(?<=name:\s)([A-Z][a-z]+(\s[A-Z][a-z]+)?)/gi
        ];

        namePatterns.forEach(pattern => {
            if (pattern.test(redactedMessage)) {
                redactedMessage = redactedMessage.replace(pattern, '[PATIENT_NAME]');
                redactionCount++;
            }
        });

        // 5. Redact Dates (DOB etc)
        // Patterns: DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD
        const dateRegex = /\b\d{1,4}[-./]\d{1,2}[-./]\d{1,4}\b/g;
        if (dateRegex.test(redactedMessage)) {
            redactedMessage = redactedMessage.replace(dateRegex, '[DATE]');
            redactionCount++;
        }

        // 6. Redact Symptoms (Specific requirement: "Medical symptoms beyond general terms")
        // NOTE: This is tricky to do perfectly without an NLP model. 
        // We will redact the specific complex symptoms mentioned in the prompt example if they appear in a "I have..." structure,
        // BUT we must allow the Triage Service to see it first.

        // Strict redaction of "chest pain" as per example "I have chest pain" -> "I have [SYMPTOM]"
        // We can extend this list.
        const sensitiveSymptoms = [
            'chest pain', 'heart attack', 'bleeding', 'shortness of breath', 'suicidal', 'overdose'
        ];

        const symptomRegex = new RegExp(`\\b(${sensitiveSymptoms.join('|')})\\b`, 'gi');
        if (symptomRegex.test(redactedMessage)) {
            redactedMessage = redactedMessage.replace(symptomRegex, '[SYMPTOM]');
            redactionCount++;
        }

        // 7. Apply Redaction
        if (redactionCount > 0) {
            logger.info(`PHI Redaction: Masked ${redactionCount} items in request. Original length: ${originalMessage.length}, New: ${redactedMessage.length}`);

            auditLogger.info({
                action: 'PHI_REDACTION',
                conversationId: req.sessionID || 'unknown',
                actor: 'middleware',
                data: {
                    redacted_count: redactionCount,
                    original_length: originalMessage.length,
                    redacted_length: redactedMessage.length
                }
            });

            req.body.message = redactedMessage;
        }

        next();

    } catch (error) {
        logger.error('PHI Redaction Middleware Error', error);
        // Fail safe: If redaction fails, do not block request but log CRITICAL warning
        // In production, you might want to block to be safe.
        // For now, we continue but with original message (or block if strict).
        // Let's BLOCK to be safe for healthcare.
        return res.status(500).json({ error: 'Security limitation. Please retry.' });
    }
};

module.exports = redactPhi;
