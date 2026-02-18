const { logger } = require('../config/logger');

// Language Codes
const LANG = {
    EN: 'English',
    AR: 'Arabic',
    RO: 'Roman Arabic'
};

/**
 * Language Enforcement Middleware
 * Forces the user to select a language at the start of the session.
 * 
 * MULTI-TENANT: Uses req.hospitalSession (hospital-scoped session)
 * so each hospital has independent language state.
 */
const enforceLanguage = (req, res, next) => {
    try {
        // Use hospital-scoped session if available, fall back to req.session
        const session = req.hospitalSession || req.session;
        // Check raw message (unredacted) for language cues if needed
        const userMessage = (res.locals.rawMessage || req.body.message || '').trim().toLowerCase();

        // 1. Language already set? Proceed.
        if (session.preferredLanguage) {
            // Check for explicit switch keywords mid-conversation
            if (userMessage === 'english' || userMessage === 'change to english') {
                session.preferredLanguage = LANG.EN;
                logger.info(`Language switched to ${LANG.EN}`);
                return res.json({ reply: "Language switched to English. How can I help you?" });
            }
            if (['arabic', 'العربية', 'عربي'].includes(userMessage)) {
                session.preferredLanguage = LANG.AR;
                logger.info(`Language switched to ${LANG.AR}`);
                return res.json({ reply: "تم تغيير اللغة إلى العربية. تفضل، كيف يمكنني مساعدتك؟" });
            }
            if (['roman arabic', 'arabizi', '3arabizi'].includes(userMessage)) {
                session.preferredLanguage = LANG.RO;
                logger.info(`Language switched to ${LANG.RO}`);
                return res.json({ reply: "Language switched to Roman Arabic (Arabizi). Tafadal, kif agdar asa3dak?" });
            }

            return next();
        }

        // 2. Emergency Bypass (Pre-Language) -> Return safety response IMMEDIATELY
        const EMERGENCY_KEYWORDS = [
            'heart attack', 'chest pain', 'cardiac', 'stroke', 'bleeding', 'unconscious',
            'breathing', 'seizure', 'suicide', 'kill myself', 'hurt myself', 'poison', 'dying',
            'help', 'emergency', 'ambulance', '997'
        ];
        if (EMERGENCY_KEYWORDS.some(k => userMessage.includes(k))) {
            logger.warn(`Emergency Detected Pre-Language: Returning safety response directly.`);
            return res.json({
                reply: "⚠️ **URGENT MEDICAL WARNING** ⚠️\n\nYour symptoms may indicate a life-threatening emergency.\n\n**PLEASE CALL EMERGENCY SERVICES (997) OR VISIT THE NEAREST ER IMMEDIATELY.**\n\nDo NOT wait for an appointment.\n\n---\n\n_This is an automated safety response. No data has been collected or processed._"
            });
        }

        // 3. Selection Logic (for text-based fallback)
        if (userMessage.includes('english')) {
            session.preferredLanguage = LANG.EN;
            logger.info(`Language selected: ${LANG.EN}`);
            return next();
        }

        if (['العربية', 'عربي'].some(w => userMessage.includes(w)) || userMessage === 'arabic') {
            session.preferredLanguage = LANG.AR;
            logger.info(`Language selected: ${LANG.AR}`);
            return next();
        }

        if (['roman arabic', 'arabizi', 'roman'].some(w => userMessage.includes(w))) {
            session.preferredLanguage = LANG.RO;
            logger.info(`Language selected: ${LANG.RO}`);
            return next();
        }

        // 4. No selection -> Return needsLanguage flag so frontend shows buttons
        const hospital = req.hospital || res.locals.hospital || {};
        const welcomeEn = hospital.welcome_message?.en || "Welcome to Al Shifa Hospital";
        const welcomeAr = hospital.welcome_message?.ar || "مرحبًا بكم في مستشفى الشفاء";

        return res.json({
            reply: `${welcomeEn} / ${welcomeAr}\n\nPlease select your preferred language / الرجاء اختيار اللغة`,
            needsLanguage: true
        });

    } catch (error) {
        logger.error('Language Middleware Error', error);
        res.status(500).json({ error: 'System error.' });
    }
};

module.exports = { enforceLanguage, LANG };
