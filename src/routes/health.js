const express = require('express');
const router = express.Router();
const redisClient = require('../config/redis');
const { emailQueue, bookingQueue } = require('../config/queue');
const axios = require('axios');
const { logger } = require('../config/logger');

// --- Health Check Logic ---

async function checkRedis() {
    const start = Date.now();
    try {
        await redisClient.ping();
        return { status: 'UP', latency_ms: Date.now() - start };
    } catch (error) {
        logger.error('Health Check Failed: Redis', error);
        return { status: 'DOWN', error: 'Connection Refused', latency_ms: Date.now() - start };
    }
}

async function checkQueue() {
    try {
        // Check if Mock Mode
        if (!emailQueue || emailQueue.constructor.name === 'Object') {
            return { status: 'UP', mode: 'MOCK', active_jobs: 0 };
        }

        const counts = await emailQueue.getJobCounts('active', 'failed');
        return {
            status: 'UP',
            mode: 'REAL',
            active_jobs: counts.active,
            failed_jobs: counts.failed
        };
    } catch (error) {
        logger.error('Health Check Failed: Queue', error);
        return { status: 'DOWN', error: error.message };
    }
}

async function checkAI() {
    const start = Date.now();
    try {
        // Simple connectivity check to OpenRouter (metadata endpoint or just root)
        // We use a light GET request.
        await axios.get('https://openrouter.ai/api/v1/models', { timeout: 2000 });
        return { status: 'UP', latency_ms: Date.now() - start };
    } catch (error) {
        // 401 is generic if key missing, but connectivity is OK. 
        // 200 is best. Network error is DOWN.
        if (error.response && error.response.status < 500) {
            return { status: 'UP', latency_ms: Date.now() - start, note: 'Authenticated/Reachability OK' };
        }
        return { status: 'DOWN', error: error.message, latency_ms: Date.now() - start };
    }
}

// --- Routes ---

// Combined Health Check
router.get('/', async (req, res) => {
    const redis = await checkRedis();
    const queue = await checkQueue();
    const ai = await checkAI();

    const systemStatus = (redis.status === 'UP' && queue.status === 'UP') ? 'UP' : 'DEGRADED';

    res.json({
        status: systemStatus,
        timestamp: new Date().toISOString(),
        checks: {
            redis,
            queue,
            ai
        }
    });
});

// Detail Routes
router.get('/redis', async (req, res) => {
    const status = await checkRedis();
    res.status(status.status === 'UP' ? 200 : 503).json(status);
});

router.get('/queue', async (req, res) => {
    const status = await checkQueue();
    res.status(status.status === 'UP' ? 200 : 503).json(status);
});

router.get('/ai-provider', async (req, res) => {
    const status = await checkAI();
    res.status(status.status === 'UP' ? 200 : 503).json(status);
});

module.exports = router;
