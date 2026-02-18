/**
 * SMS Worker - Phase 5
 * 
 * Processes SMS jobs from the smsQueue.
 * Uses the SMS provider factory for actual sending.
 * 
 * PHI SAFETY: Phone numbers are NEVER logged.
 * Uses maskPhone() from SMS provider for safe logging.
 */

const { Worker } = require('bullmq');
const { logger, auditLogger } = require('../config/logger');
const redisClient = require('../config/redis');
const { getSMSProvider } = require('../providers/smsProviderFactory');

/**
 * Start the SMS worker.
 * Processes jobs from the 'smsQueue'.
 */
const startSMSWorker = () => {
    // Skip if mocking Redis
    if (redisClient.constructor.name === 'MockRedis') {
        logger.info('SMS Worker: Skipped (Mock Redis mode)');
        return null;
    }

    const connection = {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined
    };

    const smsProvider = getSMSProvider();

    const worker = new Worker('smsQueue', async (job) => {
        const { to, message, senderId, bookingId, hospitalId } = job.data;

        logger.info(`SMS Worker: Processing job ${job.id} for booking ${bookingId}`);

        try {
            const result = await smsProvider.sendSMS({
                to,
                message,
                senderId
            });

            if (result.success) {
                // Audit log (PHI-safe: no phone number)
                auditLogger.info({
                    action: 'SMS_SENT',
                    hospital_id: hospitalId,
                    actor: 'system',
                    data: {
                        booking_id: bookingId,
                        message_id: result.messageId,
                        provider: smsProvider.getName()
                    }
                });

                logger.info(`SMS Worker: Job ${job.id} completed successfully`);
                return result;
            } else {
                // Log failure (PHI-safe)
                logger.error(`SMS Worker: Job ${job.id} failed - ${result.error}`);
                throw new Error(result.error);
            }
        } catch (err) {
            // PHI-safe error logging
            logger.error(`SMS Worker: Job ${job.id} error`, {
                error: err.message,
                bookingId,
                hospitalId
                // Never log: to, message
            });
            throw err; // Rethrow for retry
        }
    }, {
        connection,
        limiter: {
            max: 5,         // Max 5 SMS per second (rate limiting)
            duration: 1000
        }
    });

    worker.on('completed', (job) => {
        logger.info(`SMS Worker: Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
        logger.error(`SMS Worker: Job ${job?.id} failed permanently`, {
            error: err.message,
            attempts: job?.attemptsMade
        });

        // Audit log the failure (PHI-safe)
        if (job?.data) {
            auditLogger.warn({
                action: 'SMS_FAILED',
                hospital_id: job.data.hospitalId,
                actor: 'system',
                data: {
                    booking_id: job.data.bookingId,
                    error: err.message,
                    attempts: job.attemptsMade
                }
            });
        }
    });

    logger.info('SMS Worker: Started and listening for jobs');
    return worker;
};

module.exports = startSMSWorker;
