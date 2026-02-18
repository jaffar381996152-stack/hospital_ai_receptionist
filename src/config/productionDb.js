/**
 * Production Database Configuration
 * 
 * PostgreSQL-only database configuration for both development and production.
 * 
 * COMPLIANCE RULES:
 * - PostgreSQL required for all environments
 * - Fail-fast on DB unavailable
 * - Hospital-scoped data isolation
 * - No PHI in persisted data
 */

const { Pool } = require('pg');
const { logger } = require('./logger');
const { PostgresAdapter } = require('./dbAdapter');

/**
 * Database connection configuration.
 * Reads from environment variables.
 */
const DB_CONFIG = {
    // PostgreSQL connection string (preferred)
    connectionString: process.env.DATABASE_URL,

    // Individual connection params (fallback)
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DATABASE || 'hospital_ai',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD,

    // Connection pool settings
    max: 20,                        // Max connections in pool
    idleTimeoutMillis: 30000,       // Close idle connections after 30s
    connectionTimeoutMillis: 5000,  // Fail fast if can't connect in 5s

    // SSL for production (Oracle Cloud requires it)
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

/**
 * Create PostgreSQL connection pool.
 * Fails fast if database is unavailable.
 */
async function createPostgresPool() {
    const config = DB_CONFIG.connectionString
        ? { connectionString: DB_CONFIG.connectionString, ssl: DB_CONFIG.ssl }
        : DB_CONFIG;

    const pool = new Pool(config);

    // Handle pool errors
    pool.on('error', (err) => {
        logger.error('Unexpected PostgreSQL pool error:', err);
        // Don't crash, but log for monitoring
    });

    // Test connection immediately (fail-fast)
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as time');
        client.release();
        logger.info(`PostgreSQL connected: ${result.rows[0].time}`);
    } catch (err) {
        logger.error('FATAL: Cannot connect to PostgreSQL database');
        logger.error(`Connection error: ${err.message}`);
        throw new Error(`Database connection failed: ${err.message}`);
    }

    return pool;
}

/**
 * Initialize the database adapter.
 * 
 * Returns: PostgresAdapter
 * 
 * FAILS FAST if PostgreSQL is unavailable
 */
let dbAdapter = null;

async function initializeDatabase() {
    if (dbAdapter) return dbAdapter;

    logger.info(`Database initialization: env=${process.env.NODE_ENV || 'development'}`);

    const pool = await createPostgresPool();
    dbAdapter = new PostgresAdapter(pool);

    return dbAdapter;
}

/**
 * Get the current database adapter.
 * Throws if not initialized.
 */
function getDatabase() {
    if (!dbAdapter) {
        throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    return dbAdapter;
}

/**
 * Check database health.
 */
async function checkDatabaseHealth() {
    try {
        const db = getDatabase();
        await db.get('SELECT 1');
        return { status: 'healthy' };
    } catch (err) {
        return { status: 'unhealthy', error: err.message };
    }
}

/**
 * Close database connections gracefully.
 */
async function closeDatabase() {
    if (dbAdapter && dbAdapter.pool) {
        await dbAdapter.pool.end();
        logger.info('PostgreSQL pool closed');
    }
    dbAdapter = null;
}

module.exports = {
    initializeDatabase,
    getDatabase,
    checkDatabaseHealth,
    closeDatabase,
    DB_CONFIG
};
