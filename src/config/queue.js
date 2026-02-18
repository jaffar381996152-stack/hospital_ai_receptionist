const { Queue } = require('bullmq');
const redisClient = require('./redis'); // Using our ioredis client (or mock)
const { logger } = require('./logger');

let emailQueue;
let bookingQueue;
let smsQueue;

/**
 * Default job options for all queues.
 * Phase 7 Hardening: Retry logic with exponential backoff.
 */
const DEFAULT_JOB_OPTIONS = {
    attempts: 3,                          // Retry up to 3 times
    backoff: {
        type: 'exponential',
        delay: 5000                       // Start with 5s, then 10s, then 20s
    },
    removeOnComplete: 100,                // Keep last 100 completed jobs
    removeOnFail: 50                      // Keep last 50 failed jobs
};

try {
    // BullMQ requires a *real* Redis connection. 
    // If we are using the MockRedis from ./redis, BullMQ will fail or needs mock handling.
    // For Production Hardening, we assume Redis is available or we disable queues.

    // Note: BullMQ creates its own connections usually, but we can reuse config.
    const connection = {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined
    };

    if (process.env.REDIS_URL) {
        // Parse URL if provided (Simplified) or just use connection obj
    }

    // Check if we are mocking
    if (redisClient.constructor.name === 'MockRedis') {
        logger.warn('Queue System Disabled: Running in Mock/Dev Mode (No real Redis).');
        emailQueue = { add: async () => logger.warn('Queue Mock: Email job skipped.'), close: async () => { } };
        bookingQueue = { add: async () => logger.warn('Queue Mock: Booking job skipped.'), close: async () => { } };
        smsQueue = { add: async () => logger.warn('Queue Mock: SMS job skipped.'), close: async () => { } };
    } else {
        emailQueue = new Queue('emailQueue', {
            connection,
            defaultJobOptions: DEFAULT_JOB_OPTIONS
        });
        bookingQueue = new Queue('bookingQueue', {
            connection,
            defaultJobOptions: DEFAULT_JOB_OPTIONS
        });
        smsQueue = new Queue('smsQueue', {
            connection,
            defaultJobOptions: DEFAULT_JOB_OPTIONS
        });

        emailQueue.on('error', (err) => logger.error('Email Queue Error', err));
        bookingQueue.on('error', (err) => logger.error('Booking Queue Error', err));
        smsQueue.on('error', (err) => logger.error('SMS Queue Error', err));

        logger.info('BullMQ Queues Initialized with retry config (attempts: 3, backoff: exponential)');
    }

} catch (err) {
    logger.error('Failed to initialize Queues', err);
    // Fallback mocks to prevent crash
    emailQueue = { add: async () => { }, close: async () => { } };
    bookingQueue = { add: async () => { }, close: async () => { } };
    smsQueue = { add: async () => { }, close: async () => { } };
}

module.exports = { emailQueue, bookingQueue, smsQueue, DEFAULT_JOB_OPTIONS };


