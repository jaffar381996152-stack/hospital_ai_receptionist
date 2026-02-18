const crypto = require('crypto');
const { logger } = require('../config/logger');

/**
 * Request Correlation Middleware
 * Assigns a unique ID to every request for tracing.
 */
const requestIdMiddleware = (req, res, next) => {
    // 1. Check if ID exists in header (from upstream load balancer etc)
    const existingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];

    // 2. Generate or reuse
    const id = existingId || crypto.randomUUID();

    // 3. Attach to Request and Response
    req.id = id;
    res.setHeader('X-Request-ID', id);

    // 4. Log start (Optional, but good for debug)
    // logger.debug(`Request Started: ${id} ${req.method} ${req.url}`);

    next();
};

module.exports = requestIdMiddleware;
