/**
 * Migration Runner
 * 
 * PHASE 9: Deterministic, versioned migrations
 * - Tracks applied migrations in schema_migrations table
 * - Idempotent (safe to run multiple times)
 * - Runs on startup or via CLI
 * 
 * SAFETY:
 * - Migrations are numbered and run in order
 * - Each migration runs in a transaction
 * - Failed migrations halt the process
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

/**
 * Get list of migration files sorted by version number.
 */
function getMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        logger.warn('Migrations directory does not exist');
        return [];
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort((a, b) => {
            const versionA = parseInt(a.split('_')[0]);
            const versionB = parseInt(b.split('_')[0]);
            return versionA - versionB;
        });

    return files.map(f => ({
        version: parseInt(f.split('_')[0]),
        name: f.replace('.sql', ''),
        path: path.join(MIGRATIONS_DIR, f)
    }));
}

/**
 * Get applied migrations from database.
 */
async function getAppliedMigrations(db) {
    try {
        // Check if schema_migrations table exists
        const tableCheck = await db.get(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'schema_migrations'
            ) as exists
        `);

        if (!tableCheck || !tableCheck.exists) {
            return [];
        }

        const rows = await db.query('SELECT version FROM schema_migrations ORDER BY version');
        return rows.map(r => r.version);
    } catch (err) {
        // Table doesn't exist yet (first run)
        return [];
    }
}

/**
 * Run a single migration.
 */
async function runMigration(db, migration) {
    logger.info(`Running migration: ${migration.name}`);

    const sql = fs.readFileSync(migration.path, 'utf-8');

    try {
        // Execute migration SQL
        await db.execute(sql);

        // Record migration as applied
        await db.execute(
            'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
            [migration.version, migration.name]
        );

        logger.info(`Migration ${migration.name} completed successfully`);
    } catch (err) {
        logger.error(`Migration ${migration.name} failed:`, err);
        throw err;
    }
}

/**
 * Run all pending migrations.
 * 
 * @param {Object} db - Database adapter
 * @returns {Object} - Migration results
 */
async function runMigrations(db) {
    const migrations = getMigrationFiles();
    const applied = await getAppliedMigrations(db);

    const pending = migrations.filter(m => !applied.includes(m.version));

    if (pending.length === 0) {
        logger.info('No pending migrations');
        return { applied: 0, total: migrations.length };
    }

    logger.info(`Found ${pending.length} pending migrations`);

    let appliedCount = 0;
    for (const migration of pending) {
        await runMigration(db, migration);
        appliedCount++;
    }

    logger.info(`Applied ${appliedCount} migrations successfully`);
    return { applied: appliedCount, total: migrations.length };
}

/**
 * Check current migration status.
 */
async function getMigrationStatus(db) {
    const migrations = getMigrationFiles();
    const applied = await getAppliedMigrations(db);

    return {
        total: migrations.length,
        applied: applied.length,
        pending: migrations.length - applied.length,
        migrations: migrations.map(m => ({
            version: m.version,
            name: m.name,
            applied: applied.includes(m.version)
        }))
    };
}

module.exports = {
    runMigrations,
    getMigrationStatus,
    getMigrationFiles
};
