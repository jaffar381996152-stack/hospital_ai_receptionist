const Redis = require('ioredis');
const { logger } = require('./logger');

let redisClient;

if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy(times) {
            const delay = Math.min(times * 50, 2000);
            return delay;
        },
    });

    redisClient.on('error', (err) => {
        logger.error('Redis Client Error', err);
    });

    redisClient.on('connect', () => {
        logger.info('Connected to Redis');
    });

} else {
    logger.warn('REDIS_URL not set. Using Mock Redis (Memory) - NOT FOR PRODUCTION');

    // Minimal Mock Implementation for Session & Rate Limit Fallback
    class MockRedis {
        constructor() {
            this.data = new Map();
        }

        // Standard Redis commands needed for sessions/rate-limit
        async get(key) {
            return this.data.get(key) || null;
        }
        async set(key, val, ...args) {
            // NX: Only set if not exists
            if (args.includes('NX') && this.data.has(key)) {
                return null;
            }

            this.data.set(key, val);

            // Handle basic expiration args if needed (mock implementation simplified)
            if (args.includes('EX')) {
                const ttl = args[args.indexOf('EX') + 1];
                setTimeout(() => this.data.delete(key), ttl * 1000);
            }
            return 'OK';
        }
        async del(keys) {
            // Handle variadic/array keys for ioredis compatibility
            const keyList = Array.isArray(keys) ? keys : [keys];
            let count = 0;
            for (const key of keyList) {
                if (this.data.delete(key)) count++;
            }
            return count;
        }
        async expire(key, seconds) {
            if (this.data.has(key)) {
                setTimeout(() => this.data.delete(key), seconds * 1000);
                return 1;
            }
            return 0;
        }
        async pExpire(key, milliseconds) {
            if (this.data.has(key)) {
                setTimeout(() => this.data.delete(key), milliseconds);
                return 1;
            }
            return 0;
        }
        async quit() { return true; }

        // For connect-redis
        duplicate() { return new MockRedis(); }
        on(event, cb) { if (event === 'connect') cb(); }
    }

    redisClient = new MockRedis();
}

module.exports = redisClient;
