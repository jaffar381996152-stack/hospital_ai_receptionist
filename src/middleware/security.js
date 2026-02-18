const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redisClient = require('../config/redis');
const { logger } = require('../config/logger');

// 1. Helmet: Secure HTTP Headers
const helmetMiddleware = helmet();

// 2. CORS: Strict Origin Policy
// Allow localhost and explicitly trusted domains
const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    process.env.FRONTEND_URL // Allow prod frontend if set
].filter(Boolean);

const corsMiddleware = cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logger.warn(`Blocked CORS request from: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'], // Custom headers
    credentials: true
});

// 3. Rate Limiting: Distributed (Redis) or Memory Fallback
// Note: rate-limit-redis requires a real redis client. 
// If using MockRedis, we fallback to standard memory store of express-rate-limit.

let limiterStore;

if (process.env.REDIS_URL) {
    // Only use Redis store if we actually have a Redis URL
    limiterStore = new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    });
}
// Default undefined `store` uses MemoryStore which is what we want for fallback

const rateLimitMiddleware = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    store: limiterStore,
    handler: (req, res) => {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
            error: 'Too many requests, please try again later.'
        });
    }
});

// Input Sanitization Middleware (Basic)
const sanitizeInput = (req, res, next) => {
    if (req.body) {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                // Remove generic script tags - basic XSS prevention backup
                req.body[key] = req.body[key]
                    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "")
                    .replace(/on\w+=/g, "");
            }
        }
    }
    next();
};

module.exports = {
    helmetMiddleware,
    corsMiddleware,
    rateLimitMiddleware,
    sanitizeInput
};
