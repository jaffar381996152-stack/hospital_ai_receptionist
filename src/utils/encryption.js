const crypto = require('crypto');
const { logger } = require('../config/logger');

// Retrieve or Generate Key
// NOTE: In production, this MUST be a fixed env var. 
// If generic random, data is lost on restart.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
    // Should be caught by envValidator, but double check
    throw new Error('FATAL: ENCRYPTION_KEY missing. Cannot start encryption service.');
}

// Convert hex key to buffer (must be 32 bytes for aes-256)
// If checking length: Buffer.from(key, 'hex').length should be 32.
// We handle flexible input by hashing it to ensure 32 bytes if needed, but best practice is providing strict 32 byte hex.
const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex').length === 32
    ? Buffer.from(ENCRYPTION_KEY, 'hex')
    : crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();

const IV_LENGTH = 16; // For AES, this is always 16

const encrypt = (text) => {
    if (!text) return text;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
        let encrypted = cipher.update(String(text));
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (err) {
        logger.error('Encryption Failed', err);
        throw new Error('Encryption Service Error');
    }
};

const decrypt = (text) => {
    if (!text) return text;
    try {
        const parts = text.split(':');
        if (parts.length !== 2) return text; // Not encrypted or invalid format check

        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = Buffer.from(parts[1], 'hex');

        const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (err) {
        logger.error('Decryption Failed', err);
        return '[DECRYPTION_ERROR]';
    }
};

module.exports = { encrypt, decrypt };
