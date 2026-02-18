/**
 * OTP Service - Phase 4
 * 
 * Enhanced OTP handling with security measures:
 * - OTP stored as SHA-256 hash only (never plaintext)
 * - 5-minute expiry
 * - Rate limiting: 3 attempts per phone per 15 minutes
 * - Tied to booking_id
 */

const crypto = require('crypto');
const redisClient = require('../config/redis');
const { logger, auditLogger } = require('../config/logger');

// Configuration
const OTP_EXPIRY_SECONDS = 300; // 5 minutes
const RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 3;
const OTP_LENGTH = 6;

// Redis key prefixes
const OTP_PREFIX = 'otp:';
const OTP_ATTEMPTS_PREFIX = 'otp:attempts:';
const RATE_LIMIT_PREFIX = 'otp:ratelimit:';

/**
 * Generate SHA-256 hash of OTP.
 * @param {string} otp - Plain OTP
 * @returns {string} Hash
 */
function hashOtp(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * Generate secure random OTP.
 * @returns {string} 6-digit OTP
 */
function generateOtpCode() {
    return crypto.randomInt(100000, 999999).toString();
}

/**
 * Get Redis key for OTP hash.
 * @param {string} bookingId - Booking ID
 * @returns {string} Redis key
 */
function getOtpKey(bookingId) {
    return `${OTP_PREFIX}${bookingId}`;
}

/**
 * Get Redis key for OTP attempts counter.
 * @param {string} bookingId - Booking ID
 * @returns {string} Redis key
 */
function getAttemptsKey(bookingId) {
    return `${OTP_ATTEMPTS_PREFIX}${bookingId}`;
}

/**
 * Get Redis key for rate limiting.
 * @param {string} phone - Phone number (hashed for privacy)
 * @returns {string} Redis key
 */
function getRateLimitKey(phone) {
    const phoneHash = crypto.createHash('sha256').update(phone).digest('hex').substring(0, 16);
    return `${RATE_LIMIT_PREFIX}${phoneHash}`;
}

class OtpService {

    /**
     * Check rate limit for phone number.
     * 
     * @param {string} phone - Phone number
     * @returns {Promise<Object>} { allowed: boolean, remaining: number, retryAfter: number }
     */
    static async checkRateLimit(phone) {
        const key = getRateLimitKey(phone);

        try {
            const current = await redisClient.get(key);
            const count = current ? parseInt(current, 10) : 0;

            if (count >= RATE_LIMIT_MAX_ATTEMPTS) {
                const ttl = await redisClient.ttl(key);

                logger.warn(`OtpService: Rate limit exceeded for phone (hash: ${key.substring(0, 20)}...)`);

                return {
                    allowed: false,
                    remaining: 0,
                    retryAfter: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS
                };
            }

            return {
                allowed: true,
                remaining: RATE_LIMIT_MAX_ATTEMPTS - count,
                retryAfter: 0
            };
        } catch (err) {
            logger.error('OtpService: Rate limit check failed', err);
            // Fail open (allow) in case of Redis error
            return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS, retryAfter: 0 };
        }
    }

    /**
     * Increment rate limit counter.
     * 
     * @param {string} phone - Phone number
     */
    static async incrementRateLimit(phone) {
        const key = getRateLimitKey(phone);

        try {
            const exists = await redisClient.exists(key);

            if (exists) {
                await redisClient.incr(key);
            } else {
                await redisClient.set(key, '1', 'EX', RATE_LIMIT_WINDOW_SECONDS);
            }
        } catch (err) {
            logger.error('OtpService: Rate limit increment failed', err);
        }
    }

    /**
     * Generate OTP for a booking.
     * 
     * - Checks rate limit
     * - Generates 6-digit OTP
     * - Stores SHA-256 hash in Redis (never plaintext)
     * - Returns plaintext OTP for sending to patient
     * 
     * @param {string} bookingId - Booking ID
     * @param {string} phone - Patient phone (for rate limiting)
     * @returns {Promise<Object>} { success: boolean, otp?: string, error?: string }
     */
    static async generateOtp(bookingId, phone) {
        // Check rate limit
        const rateLimit = await this.checkRateLimit(phone);

        if (!rateLimit.allowed) {
            logger.warn(`OtpService: Rate limited - booking ${bookingId}`);

            auditLogger.info({
                action: 'OTP_RATE_LIMITED',
                actor: 'system',
                data: {
                    booking_id: bookingId,
                    retry_after: rateLimit.retryAfter
                }
            });

            return {
                success: false,
                error: `Too many OTP requests. Please try again in ${Math.ceil(rateLimit.retryAfter / 60)} minutes.`
            };
        }

        // Generate OTP
        const otp = generateOtpCode();
        const otpHash = hashOtp(otp);

        // Store hash in Redis (NEVER store plaintext)
        const key = getOtpKey(bookingId);
        await redisClient.set(key, otpHash, 'EX', OTP_EXPIRY_SECONDS);

        // Reset attempts counter
        const attemptsKey = getAttemptsKey(bookingId);
        await redisClient.del(attemptsKey);

        // Increment rate limit
        await this.incrementRateLimit(phone);

        logger.info(`OtpService: OTP generated for booking ${bookingId} (expires in ${OTP_EXPIRY_SECONDS}s)`);

        auditLogger.info({
            action: 'OTP_GENERATED',
            actor: 'system',
            data: {
                booking_id: bookingId,
                expiry_seconds: OTP_EXPIRY_SECONDS
                // NEVER log actual OTP
            }
        });

        return {
            success: true,
            otp: otp  // Return plaintext to send to patient
        };
    }

    /**
     * Verify OTP for a booking.
     * 
     * - Compares hash (not plaintext)
     * - Limits verification attempts
     * - Consumes OTP on success (one-time use)
     * 
     * @param {string} bookingId - Booking ID
     * @param {string} userCode - OTP entered by user
     * @returns {Promise<Object>} { valid: boolean, error?: string }
     */
    static async verifyOtp(bookingId, userCode) {
        const key = getOtpKey(bookingId);
        const attemptsKey = getAttemptsKey(bookingId);

        try {
            // Check if OTP exists
            const storedHash = await redisClient.get(key);

            if (!storedHash) {
                logger.warn(`OtpService: OTP expired or not found for ${bookingId}`);

                return {
                    valid: false,
                    error: 'OTP expired. Please request a new one.'
                };
            }

            // Check verification attempts
            const attempts = await redisClient.get(attemptsKey);
            const attemptCount = attempts ? parseInt(attempts, 10) : 0;

            if (attemptCount >= RATE_LIMIT_MAX_ATTEMPTS) {
                // Too many failed attempts - invalidate OTP
                await redisClient.del(key);

                logger.warn(`OtpService: Too many failed verification attempts for ${bookingId}`);

                auditLogger.info({
                    action: 'OTP_ATTEMPTS_EXCEEDED',
                    actor: 'system',
                    data: { booking_id: bookingId }
                });

                return {
                    valid: false,
                    error: 'Too many failed attempts. Please request a new OTP.'
                };
            }

            // Hash user code and compare
            const userHash = hashOtp(userCode.trim());

            if (userHash === storedHash) {
                // Valid OTP - consume it (one-time use)
                await redisClient.del(key);
                await redisClient.del(attemptsKey);

                logger.info(`OtpService: OTP verified successfully for ${bookingId}`);

                auditLogger.info({
                    action: 'OTP_VERIFIED',
                    actor: 'system',
                    data: { booking_id: bookingId }
                });

                return { valid: true };
            }

            // Invalid OTP - increment attempts
            if (await redisClient.exists(attemptsKey)) {
                await redisClient.incr(attemptsKey);
            } else {
                await redisClient.set(attemptsKey, '1', 'EX', OTP_EXPIRY_SECONDS);
            }

            const remainingAttempts = RATE_LIMIT_MAX_ATTEMPTS - attemptCount - 1;

            logger.warn(`OtpService: Invalid OTP for ${bookingId}. ${remainingAttempts} attempts remaining`);

            auditLogger.info({
                action: 'OTP_INVALID',
                actor: 'system',
                data: {
                    booking_id: bookingId,
                    remaining_attempts: remainingAttempts
                }
            });

            return {
                valid: false,
                error: `Invalid code. ${remainingAttempts} attempts remaining.`
            };

        } catch (err) {
            logger.error('OtpService: Verification error', err);
            return {
                valid: false,
                error: 'Verification failed. Please try again.'
            };
        }
    }

    /**
     * Check if OTP exists (not expired).
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<boolean>} True if exists
     */
    static async hasActiveOtp(bookingId) {
        const key = getOtpKey(bookingId);
        return await redisClient.exists(key);
    }

    /**
     * Get remaining TTL for OTP.
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<number>} TTL in seconds, or -1 if expired
     */
    static async getOtpTtl(bookingId) {
        const key = getOtpKey(bookingId);
        return await redisClient.ttl(key);
    }

    /**
     * Invalidate OTP (e.g., on booking cancellation).
     * 
     * @param {string} bookingId - Booking ID
     */
    static async invalidateOtp(bookingId) {
        const key = getOtpKey(bookingId);
        const attemptsKey = getAttemptsKey(bookingId);

        await redisClient.del(key);
        await redisClient.del(attemptsKey);

        logger.info(`OtpService: OTP invalidated for ${bookingId}`);
    }
}

// Export configuration for testing
module.exports = {
    OtpService,
    OTP_EXPIRY_SECONDS,
    RATE_LIMIT_MAX_ATTEMPTS,
    RATE_LIMIT_WINDOW_SECONDS,
    hashOtp
};
