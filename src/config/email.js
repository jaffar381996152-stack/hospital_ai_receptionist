const nodemailer = require('nodemailer');
const { logger } = require('./logger');

const isEmailEnabled = process.env.ENABLE_EMAIL_TRANSPORT === 'true';

let transporter;

if (isEmailEnabled) {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        logger.error('Email transport enabled but credentials missing!');
    }
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    logger.info('Email Transport ENABLED');
} else {
    logger.warn('WARNING: Email Transport is DISABLED (Default). Set ENABLE_EMAIL_TRANSPORT=true to enable.');
    // Mock transporter
    transporter = {
        sendMail: async (opts) => {
            logger.info(`[Mock Email] To: ${opts.to}, Subject: ${opts.subject}, Body Preview: ${opts.text.substring(0, 50)}...`);
            return { messageId: 'mock-id' };
        }
    };
}

module.exports = { transporter };
