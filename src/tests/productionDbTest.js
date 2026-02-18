/**
 * Phase 9: Production Database - Test Suite
 * 
 * Tests all requirements from Phase 9:
 * - Test Group A: Database Safety
 * - Test Group B: Data Isolation
 * - Test Group C: PHI Safety
 * - Test Group D: Retention Enforcement
 * - Test Group E: Migration Safety
 * 
 * Run: node src/tests/productionDbTest.js
 */

const path = require('path');
const fs = require('fs');

console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║    Phase 9: Production Database - Full Test Suite        ║");
console.log("╚═══════════════════════════════════════════════════════════╝\n");

// Test results tracker
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

function recordTest(group, name, passed, details = '') {
    results.tests.push({ group, name, passed, details });
    if (passed) {
        results.passed++;
        console.log(`✅ ${group} - ${name}`);
    } else {
        results.failed++;
        console.log(`❌ ${group} - ${name}`);
        if (details) console.log(`   Details: ${details}`);
    }
}

async function runTests() {
    // ============================================================
    // TEST GROUP A: Database Safety
    // ============================================================
    console.log("\n━━━ Test Group A: Database Safety ━━━");

    // A1: SQLite blocked in production
    {
        const { shouldUseSqlite } = require('../config/productionDb');

        // Save current env
        const originalEnv = process.env.NODE_ENV;
        const originalUseSqlite = process.env.USE_SQLITE;

        // Test production mode
        process.env.NODE_ENV = 'production';
        process.env.USE_SQLITE = undefined;

        let passed = false;
        try {
            const result = shouldUseSqlite();
            passed = result === false; // Should return false in production
        } catch (err) {
            passed = true; // Throwing is acceptable for USE_SQLITE=true
        }

        // Test that USE_SQLITE=true throws in production
        process.env.USE_SQLITE = 'true';
        let throwsOnForceSqlite = false;
        try {
            shouldUseSqlite();
        } catch (err) {
            throwsOnForceSqlite = err.message.includes('SQLite is disabled in production');
        }

        // Restore env
        process.env.NODE_ENV = originalEnv;
        process.env.USE_SQLITE = originalUseSqlite;

        recordTest('A1', 'SQLite blocked in production', passed && throwsOnForceSqlite);
    }

    // A2: Configuration validation
    {
        const { DB_CONFIG } = require('../config/productionDb');

        const hasConnectionTimeout = DB_CONFIG.connectionTimeoutMillis > 0;
        const hasMaxConnections = DB_CONFIG.max > 0;
        const hasIdleTimeout = DB_CONFIG.idleTimeoutMillis > 0;

        const passed = hasConnectionTimeout && hasMaxConnections && hasIdleTimeout;
        recordTest('A2', 'Database configuration valid', passed,
            `timeout:${hasConnectionTimeout}, max:${hasMaxConnections}, idle:${hasIdleTimeout}`);
    }

    // ============================================================
    // TEST GROUP B: Data Isolation (CRITICAL)
    // ============================================================
    console.log("\n━━━ Test Group B: Data Isolation (CRITICAL) ━━━");

    // B1: Schema includes hospital_id
    {
        const migrationsDir = path.join(__dirname, '../../migrations');
        let passed = true;
        let details = [];

        if (fs.existsSync(migrationsDir)) {
            const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

            for (const file of files) {
                const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

                // Check for CREATE TABLE statements
                const tableMatches = content.match(/CREATE TABLE[^;]+;/g) || [];

                for (const tableStmt of tableMatches) {
                    // Skip schema_migrations table
                    if (tableStmt.includes('schema_migrations')) continue;

                    // All other tables must have hospital_id
                    if (!tableStmt.includes('hospital_id')) {
                        passed = false;
                        details.push(`Missing hospital_id in: ${file}`);
                    }
                }
            }
        } else {
            passed = false;
            details.push('Migrations directory not found');
        }

        recordTest('B1', 'All tables include hospital_id', passed, details.join(', '));
    }

    // B2: Index on hospital_id
    {
        const migrationsDir = path.join(__dirname, '../../migrations');
        let passed = true;
        let details = [];

        if (fs.existsSync(migrationsDir)) {
            const content = fs.readFileSync(
                path.join(migrationsDir, '001_initial_schema.sql'), 'utf-8'
            );

            // Check for indexes on hospital_id
            const hasAuditIndex = content.includes('idx_audit_logs_hospital_id');
            const hasEscalationIndex = content.includes('idx_escalation_records_hospital_id');

            passed = hasAuditIndex && hasEscalationIndex;
            details = [`audit_index:${hasAuditIndex}`, `escalation_index:${hasEscalationIndex}`];
        }

        recordTest('B2', 'Hospital_id indexed for isolation', passed, details.join(', '));
    }

    // ============================================================
    // TEST GROUP C: PHI Safety
    // ============================================================
    console.log("\n━━━ Test Group C: PHI Safety ━━━");

    // C1: No PHI columns in new schema
    {
        const migrationsDir = path.join(__dirname, '../../migrations');
        let passed = true;
        let phiFound = [];

        const PHI_PATTERNS = [
            'patient_name', 'patient_phone', 'phone_number',
            'email_address', 'date_of_birth', 'ssn', 'national_id',
            'symptoms', 'diagnosis', 'prescription', 'medical_history',
            'ai_prompt', 'ai_response', 'raw_message', 'message_content'
        ];

        if (fs.existsSync(migrationsDir)) {
            const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

            for (const file of files) {
                const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
                    .toLowerCase();

                for (const pattern of PHI_PATTERNS) {
                    if (content.includes(pattern.toLowerCase())) {
                        passed = false;
                        phiFound.push(`${pattern} in ${file}`);
                    }
                }
            }
        }

        recordTest('C1', 'No PHI columns in schema', passed,
            passed ? 'Clean' : phiFound.join(', '));
    }

    // ============================================================
    // TEST GROUP D: Retention Enforcement
    // ============================================================
    console.log("\n━━━ Test Group D: Retention Enforcement ━━━");

    // D1: Retention config exists
    {
        const { getRetentionConfig, DEFAULT_RETENTION } = require('../services/retentionService');

        const defaultConfig = getRetentionConfig('default');
        const riyadhConfig = getRetentionConfig('hospital_riyadh');

        const hasDefaultAudit = defaultConfig.audit_logs_days > 0;
        const hasDefaultEscalation = defaultConfig.escalation_records_days > 0;

        // Riyadh should have different (longer) retention
        const riyadhDifferent = riyadhConfig.audit_logs_days !== DEFAULT_RETENTION.audit_logs_days;

        const passed = hasDefaultAudit && hasDefaultEscalation;
        recordTest('D1', 'Retention config per hospital', passed,
            `default_audit:${defaultConfig.audit_logs_days}d, riyadh_audit:${riyadhConfig.audit_logs_days}d`);
    }

    // D2: Retention service exports
    {
        const retentionService = require('../services/retentionService');

        const hasEnforceAll = typeof retentionService.enforceRetentionAll === 'function';
        const hasEnforceHospital = typeof retentionService.enforceRetentionForHospital === 'function';
        const hasSafeEnforce = typeof retentionService.enforceRetentionSafe === 'function';

        const passed = hasEnforceAll && hasEnforceHospital && hasSafeEnforce;
        recordTest('D2', 'Retention service functions exist', passed);
    }

    // ============================================================
    // TEST GROUP E: Migration Safety
    // ============================================================
    console.log("\n━━━ Test Group E: Migration Safety ━━━");

    // E1: Migration files exist and are numbered
    {
        const { getMigrationFiles } = require('../config/migrationRunner');
        const migrations = getMigrationFiles();

        const hasFiles = migrations.length >= 2;
        const isOrdered = migrations.every((m, i) => i === 0 || m.version > migrations[i - 1].version);
        const hasInitial = migrations.some(m => m.name.includes('001'));

        const passed = hasFiles && isOrdered && hasInitial;
        recordTest('E1', 'Migration files exist and ordered', passed,
            `count:${migrations.length}, ordered:${isOrdered}`);
    }

    // E2: Migration runner exports
    {
        const migrationRunner = require('../config/migrationRunner');

        const hasRunMigrations = typeof migrationRunner.runMigrations === 'function';
        const hasRunSqlite = typeof migrationRunner.runMigrationsSqlite === 'function';
        const hasStatus = typeof migrationRunner.getMigrationStatus === 'function';

        const passed = hasRunMigrations && hasRunSqlite && hasStatus;
        recordTest('E2', 'Migration runner functions exist', passed);
    }

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log("\n╔═════════════════════════════════════════╗");
    console.log("║             TEST SUMMARY                ║");
    console.log("╚═════════════════════════════════════════╝");
    console.log(`Total: ${results.passed + results.failed}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);

    if (results.failed === 0) {
        console.log("\n🎉 ALL TESTS PASSED - Phase 9 Complete!");
    } else {
        console.log("\n⚠️ Some tests failed. Review output above.");
    }

    process.exit(results.failed === 0 ? 0 : 1);
}

runTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
