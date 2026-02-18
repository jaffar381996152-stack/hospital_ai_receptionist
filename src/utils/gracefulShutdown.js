/**
 * Graceful Shutdown - Phase 7 Hardening
 * 
 * Centralized shutdown handler for production stability.
 * Ensures clean release of all resources on process termination.
 * 
 * Resources managed:
 * - HTTP server
 * - Redis connections
 * - Database pool
 * - BullMQ workers
 */

const { logger, auditLogger } = require('../config/logger');

// Track resources to close
let resources = {
    server: null,
    redis: null,
    database: null,
    workers: []
};

let isShuttingDown = false;

/**
 * Register resources for graceful shutdown.
 * 
 * @param {Object} opts - Resources to track
 * @param {Object} opts.server - HTTP server instance
 * @param {Object} opts.redis - Redis client
 * @param {Object} opts.database - Database adapter
 * @param {Array} opts.workers - BullMQ workers
 */
function registerResources(opts) {
    if (opts.server) resources.server = opts.server;
    if (opts.redis) resources.redis = opts.redis;
    if (opts.database) resources.database = opts.database;
    if (opts.workers) resources.workers = opts.workers;
}

/**
 * Perform graceful shutdown.
 * 
 * @param {string} signal - Signal that triggered shutdown
 */
async function shutdown(signal) {
    if (isShuttingDown) {
        logger.warn('Shutdown already in progress...');
        return;
    }

    isShuttingDown = true;
    logger.info(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    const startTime = Date.now();

    try {
        // 1. Stop accepting new connections
        if (resources.server) {
            await new Promise((resolve) => {
                resources.server.close(() => {
                    logger.info('  ✅ HTTP server closed');
                    resolve();
                });
            });
        }

        // 2. Close BullMQ workers
        for (const worker of resources.workers) {
            if (worker && typeof worker.close === 'function') {
                await worker.close();
            }
        }
        if (resources.workers.length > 0) {
            logger.info(`  ✅ ${resources.workers.length} workers closed`);
        }

        // 3. Close Redis
        if (resources.redis && typeof resources.redis.quit === 'function') {
            await resources.redis.quit();
            logger.info('  ✅ Redis connection closed');
        }

        // 4. Close database pool
        if (resources.database && typeof resources.database.close === 'function') {
            await resources.database.close();
            logger.info('  ✅ Database pool closed');
        }

        const elapsed = Date.now() - startTime;
        logger.info(`\n✅ Graceful shutdown complete (${elapsed}ms)`);

        // Audit log
        auditLogger.info({
            action: 'SERVER_SHUTDOWN',
            hospital_id: 'system',
            actor: 'system',
            data: { signal, elapsed_ms: elapsed }
        });

        process.exit(0);

    } catch (err) {
        logger.error('Error during shutdown:', err);
        process.exit(1);
    }
}

/**
 * Install shutdown handlers.
 * Should be called once after server starts.
 */
function installShutdownHandlers() {
    // Handle graceful termination
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
        logger.error('Uncaught Exception:', err);
        shutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        // Don't shutdown, but log for debugging
    });

    logger.info('Graceful shutdown handlers installed');
}

module.exports = {
    registerResources,
    shutdown,
    installShutdownHandlers
};
