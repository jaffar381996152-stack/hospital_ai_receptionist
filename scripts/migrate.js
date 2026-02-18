/**
 * Migration CLI Runner
 * 
 * Runs all pending database migrations.
 * 
 * Usage: npm run migrate
 */

const path = require('path');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { initializeDatabase, getDatabase, closeDatabase } = require('../src/config/productionDb');
const { runMigrations, getMigrationStatus, getMigrationFiles } = require('../src/config/migrationRunner');
const { logger } = require('../src/config/logger');

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║              Database Migration Runner                     ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    console.log(`Database: PostgreSQL\n`);

    let db;

    try {
        // Show available migrations
        const migrationFiles = getMigrationFiles();
        console.log(`Found ${migrationFiles.length} migration file(s):`);
        migrationFiles.forEach(m => {
            console.log(`   - ${m.name}`);
        });
        console.log('');

        // Initialize database
        console.log('Connecting to database...');
        db = await initializeDatabase();
        console.log('✅ Connected\n');

        // Run migrations
        console.log('Running pending migrations...\n');

        const result = await runMigrations(db);

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║                  MIGRATION COMPLETE                       ║');
        console.log('╚═══════════════════════════════════════════════════════════╝');
        console.log(`   Total migrations: ${result.total}`);
        console.log(`   Applied this run: ${result.applied}`);
        console.log('');

        // Show final status
        console.log('Current migration status:');
        const status = await getMigrationStatus(db);
        status.migrations.forEach(m => {
            const icon = m.applied ? '✅' : '⏳';
            console.log(`   ${icon} ${m.name}`);
        });
        console.log('');

    } catch (err) {
        console.error('\n❌ Migration failed:', err.message);
        logger.error('Migration runner failed:', err);
        process.exit(1);
    } finally {
        if (db) {
            await closeDatabase();
        }
    }
}

// Run
main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
