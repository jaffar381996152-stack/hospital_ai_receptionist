const { logger, auditLogger } = require('../config/logger');
const { LANG } = require('./languageEnforcement');

// Emergency keywords to bypass consent form (Safety First)
const EMERGENCY_KEYWORDS = [
    'heart attack', 'chest pain', 'cardiac', 'stroke', 'bleeding', 'unconscious',
    'breathing', 'seizure', 'suicide', 'kill myself', 'hurt myself', 'poison', 'dying'
];

/**
 * Consent Enforcement Middleware
 * Ensures user has agreed to the disclaimer before processing any messages.
 * 
 * MULTI-TENANT ISOLATION: Uses req.hospitalSession (hospital-scoped session).
 * Consent given at Hospital A does NOT transfer to Hospital B since each
 * hospital has its own session namespace.
 * 
 * Consent can be granted via:
 * 1. Button click (POST /set-consent endpoint - bypasses this middleware)
 * 2. Text input ("yes", "agree", etc.) - legacy fallback
 */
const checkConsent = (req, res, next) => {
    try {
        // Use hospital-scoped session if available, fall back to req.session
        const hospitalSession = req.hospitalSession || req.session;
        const userMessage = req.body.message ? req.body.message.toLowerCase().trim() : '';

        // MULTI-TENANT: Get hospital context
        const hospitalId = req.hospitalId || res.locals.hospitalId || 'default';
        const hospital = req.hospital || res.locals.hospital || { name: 'Al Shifa Hospital' };

        // 1. Check if consent already given for this hospital session
        if (hospitalSession.consentGiven) {
            return next();
        }

        // SECURITY: Emergency detected BEFORE consent
        const isEmergency = EMERGENCY_KEYWORDS.some(k => userMessage.includes(k));
        if (isEmergency) {
            logger.warn(`Emergency Detected Pre-Consent: Session ${req.sessionID}, Hospital ${hospitalId}`);

            auditLogger.info({
                action: 'EMERGENCY_PRE_CONSENT',
                hospital_id: hospitalId,
                conversationId: req.sessionID,
                actor: 'system',
                data: {
                    emergency_detected: true,
                    consent_status: 'not_given'
                }
            });

            return res.json({
                reply: "⚠️ **URGENT MEDICAL WARNING** ⚠️\n\nYour symptoms may indicate a life-threatening emergency.\n\n**PLEASE CALL EMERGENCY SERVICES (997) OR VISIT THE NEAREST ER IMMEDIATELY.**\n\nDo NOT wait for an appointment.\n\n---\n\n_This is an automated safety response. No data has been collected or processed._"
            });
        }

        // 2. Text-based consent (legacy fallback for users who type instead of clicking buttons)
        const agreementWords = ['yes', 'agree', 'ok', 'accept', 'yeah', 'sure', 'yep'];
        const agreementRegex = new RegExp(`\\b(${agreementWords.join('|')})\\b`, 'i');

        if (agreementRegex.test(userMessage)) {
            hospitalSession.consentGiven = true;
            logger.info(`Consent Granted (text): Session ${req.sessionID}, Hospital ${hospitalId}`);

            auditLogger.info({
                action: 'CONSENT_GRANTED',
                hospital_id: hospitalId,
                conversationId: req.sessionID,
                actor: 'user',
                data: { message: userMessage, method: 'text' }
            });

            const lang = hospitalSession.preferredLanguage;
            if (lang === LANG.AR) {
                return res.json({ reply: `شكراً لك. أنا موظف استقبال ${hospital.name} (AI). كيف يمكنني مساعدتك اليوم؟ (يمكنك السؤال عن المواعيد، الأقسام، أو معلومات عامة).` });
            } else if (lang === LANG.RO) {
                return res.json({ reply: `Shukran. Ana muwazaf istiqbal ${hospital.name} (AI). Kif agdar asa3dak alyaum? (Tigdar tas'al 3an maw3id, aqsam, aw ma3lumat 3amah).` });
            } else {
                return res.json({ reply: `Thank you. I am the ${hospital.name} AI Receptionist. How can I help you today? (You can ask about appointments, departments, or general information).` });
            }
        }

        // 3. Text-based denial
        if (['no', 'cancel', 'nope', 'refuse'].includes(userMessage)) {
            auditLogger.info({
                action: 'CONSENT_DENIED',
                hospital_id: hospitalId,
                conversationId: req.sessionID,
                actor: 'user',
                data: { message: userMessage, method: 'text' }
            });

            return res.json({
                reply: "Access denied. For legal and safety reasons, you must agree to the disclaimer to use this service. Please press the Yes button to proceed or call the hospital for manual assistance.",
                needsConsent: true
            });
        }

        // 4. No consent yet - return disclaimer with needsConsent flag for frontend buttons
        const lang = hospitalSession.preferredLanguage;
        let disclaimer = '';
        if (lang === LANG.AR) {
            disclaimer = `⚠️ **تنبيه هام** ⚠️\n\nيوفر هذا المساعد الآلي مساعدة إدارية فقط ولا يقدم **نصائح طبية**.\n\nالذكاء الاصطناعي قد يخطئ. في حالات الطوارئ، يرجى الاتصال بـ **997** فوراً.\n\nهل توافق على المتابعة؟`;
        } else if (lang === LANG.RO) {
            disclaimer = `⚠️ **Tanbih Ham** ⚠️\n\nHatha al-musa3ed al-ali yuqadim musa3ada idariyah faqat wa **LA** yuqadim nasa'ih tibbiyah.\n\nAl-AI mumkin yaghlata. Fi halat al-tawari, raja'an itasil bi **997** fawran.\n\nHal tuwafiq?`;
        } else {
            disclaimer = `⚠️ **IMPORTANT DISCLAIMER** ⚠️\n\nThis chatbot provides administrative assistance only and does **NOT** offer medical advice.\n\nAI can make mistakes. In a medical emergency, please call **997** immediately.\n\nDo you agree to proceed?`;
        }

        return res.json({ reply: disclaimer, needsConsent: true });

    } catch (error) {
        logger.error('Consent Middleware Error', error);
        res.status(500).json({ error: 'System error during consent check.' });
    }
};

module.exports = checkConsent;
