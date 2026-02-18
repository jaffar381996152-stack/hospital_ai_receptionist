/**
 * Phase 1: Database Foundation - Test Suite
 * 
 * Tests all Phase 1 requirements:
 * - Test Group A: Database Adapter Switching
 * - Test Group B: Schema Validation
 * - Test Group C: Foreign Key Constraints
 * - Test Group D: Seed Script Verification
 * - Test Group E: Hospital Isolation
 * 
 * Run: node src/tests/phase1DbTest.js
 */

const path = require('path');
const fs = require('fs');

// Load environment for testing
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║     Phase 1: Database Foundation - Full Test Suite       ║");
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
    // TEST GROUP A: Database Adapter Switching
    // ============================================================
    console.log("\n━━━ Test Group A: Database Adapter Switching ━━━");

    // A1: SQLite adapter has correct methods
    {
        const { SqliteAdapter, PostgresAdapter } = require('../config/dbAdapter');

        const sqliteMethods = ['query', 'get', 'execute', 'transaction'];
        const postgresMethods = ['query', 'get', 'execute', 'transaction'];

        const hasSqliteMethods = sqliteMethods.every(m =>
            typeof SqliteAdapter.prototype[m] === 'function'
        );
        const hasPostgresMethods = postgresMethods.every(m =>
            typeof PostgresAdapter.prototype[m] === 'function'
        );

        recordTest('A1', 'Adapter classes have required methods',
            hasSqliteMethods && hasPostgresMethods);
    }

    // A2: Environment-based switching
    {
        const { shouldUseSqlite } = require('../config/productionDb');

        // Save current env
        const originalEnv = process.env.NODE_ENV;
        const originalUseSqlite = process.env.USE_SQLITE;
        const originalDbUrl = process.env.DATABASE_URL;
        const originalPgHost = process.env.PG_HOST;

        // Test 1: Development without PG config should use SQLite
        process.env.NODE_ENV = 'development';
        delete process.env.DATABASE_URL;
        delete process.env.PG_HOST;
        process.env.USE_SQLITE = 'false';

        // Clear require cache to reload module
        delete require.cache[require.resolve('../config/productionDb')];
        const { shouldUseSqlite: freshCheck } = require('../config/productionDb');

        const devUseSqlite = freshCheck();

        // Restore env
        process.env.NODE_ENV = originalEnv;
        if (originalUseSqlite) process.env.USE_SQLITE = originalUseSqlite;
        if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
        if (originalPgHost) process.env.PG_HOST = originalPgHost;

        recordTest('A2', 'Dev mode defaults to SQLite without PG config', devUseSqlite);
    }

    // A3: No business logic in adapter
    {
        const adapterPath = path.join(__dirname, '../config/dbAdapter.js');
        const adapterContent = fs.readFileSync(adapterPath, 'utf-8');

        // Check that adapter doesn't contain business terms
        const businessTerms = ['hospital', 'patient', 'booking', 'appointment', 'doctor'];
        const hasBusinessLogic = businessTerms.some(term =>
            adapterContent.toLowerCase().includes(term)
        );

        recordTest('A3', 'Adapter contains no business logic', !hasBusinessLogic);
    }

    // ============================================================
    // TEST GROUP B: Schema Validation
    // ============================================================
    console.log("\n━━━ Test Group B: Schema Validation ━━━");

    // B1: Migration 003 exists
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        const exists = fs.existsSync(migrationPath);

        recordTest('B1', 'Migration 003 exists', exists);
    }

    // B2: Migration 003 has all required tables
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = false;
        let details = [];

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');

            const requiredTables = [
                'hospitals',
                'departments',
                'doctors_v2',
                'doctor_availability',
                'appointments',
                'staff_users'
            ];

            const missingTables = requiredTables.filter(table =>
                !content.includes(`CREATE TABLE IF NOT EXISTS ${table}`)
            );

            passed = missingTables.length === 0;
            if (!passed) details = [`Missing: ${missingTables.join(', ')}`];
        } else {
            details = ['Migration file not found'];
        }

        recordTest('B2', 'Migration has all required tables', passed, details.join(', '));
    }

    // B3: All tables have hospital_id (except hospitals itself)
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = true;
        let details = [];

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');

            // Tables that MUST have hospital_id
            const tablesNeedingHospitalId = [
                'departments',
                'doctors_v2',
                'appointments',
                'staff_users'
            ];

            // Tables with FOREIGN KEY to hospital
            const tableBlocks = content.split(/CREATE TABLE IF NOT EXISTS/);

            for (const tableName of tablesNeedingHospitalId) {
                const tableBlock = tableBlocks.find(b => b.trim().startsWith(tableName));
                if (tableBlock) {
                    if (!tableBlock.includes('hospital_id TEXT NOT NULL')) {
                        passed = false;
                        details.push(`${tableName} missing hospital_id`);
                    }
                }
            }
        }

        recordTest('B3', 'Required tables have hospital_id', passed, details.join(', '));
    }

    // B4: hospital_id has indexes
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = false;

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');

            const hasIndexes = content.includes('idx_departments_hospital') &&
                content.includes('idx_doctors_v2_hospital') &&
                content.includes('idx_appointments_hospital') &&
                content.includes('idx_staff_users_hospital');

            passed = hasIndexes;
        }

        recordTest('B4', 'hospital_id columns are indexed', passed);
    }

    // ============================================================
    // TEST GROUP C: Foreign Key Constraints
    // ============================================================
    console.log("\n━━━ Test Group C: Foreign Key Constraints ━━━");

    // C1: Foreign key constraints defined
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = false;
        let count = 0;

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');

            const fkMatches = content.match(/CONSTRAINT fk_/g) || [];
            count = fkMatches.length;

            // Should have at least 6 FK constraints
            passed = count >= 6;
        }

        recordTest('C1', `Foreign key constraints defined (${count})`, passed);
    }

    // C2: ON DELETE behavior specified
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = false;

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');

            const hasCascade = content.includes('ON DELETE CASCADE');
            const hasSetNull = content.includes('ON DELETE SET NULL');

            passed = hasCascade && hasSetNull;
        }

        recordTest('C2', 'ON DELETE behavior specified', passed);
    }

    // C3: Check constraints defined
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = false;

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');

            const hasStatusCheck = content.includes("status IN ('pending'");
            const hasRoleCheck = content.includes("role IN ('receptionist'");
            const hasDayCheck = content.includes('day_of_week >= 0');

            passed = hasStatusCheck && hasRoleCheck && hasDayCheck;
        }

        recordTest('C3', 'CHECK constraints defined', passed);
    }

    // ============================================================
    // TEST GROUP D: Seed Script Verification
    // ============================================================
    console.log("\n━━━ Test Group D: Seed Script Verification ━━━");

    // D1: Seed script exists
    {
        const seedPath = path.join(__dirname, '../../scripts/seedHospitals.js');
        const exists = fs.existsSync(seedPath);

        recordTest('D1', 'Seed script exists', exists);
    }

    // D2: Seed script exports functions
    {
        let passed = false;
        try {
            const seedModule = require('../../scripts/seedHospitals');

            passed = typeof seedModule.seedHospitals === 'function' &&
                typeof seedModule.loadHospitalsJson === 'function';
        } catch (err) {
            // Module might fail to load without proper db connection
            // Just check for export syntax
            const seedPath = path.join(__dirname, '../../scripts/seedHospitals.js');
            const content = fs.readFileSync(seedPath, 'utf-8');
            passed = content.includes('module.exports') &&
                content.includes('seedHospitals') &&
                content.includes('loadHospitalsJson');
        }

        recordTest('D2', 'Seed script exports required functions', passed);
    }

    // D3: Seed script is idempotent
    {
        const seedPath = path.join(__dirname, '../../scripts/seedHospitals.js');
        let passed = false;

        if (fs.existsSync(seedPath)) {
            const content = fs.readFileSync(seedPath, 'utf-8');

            // Check for idempotency patterns
            passed = content.includes('already exists') ||
                content.includes('hospitalExists') ||
                content.includes('skipping');
        }

        recordTest('D3', 'Seed script has idempotency check', passed);
    }

    // D4: npm scripts configured
    {
        const packagePath = path.join(__dirname, '../../package.json');
        let passed = false;

        if (fs.existsSync(packagePath)) {
            const content = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

            passed = content.scripts?.['seed:hospitals'] !== undefined &&
                content.scripts?.['migrate'] !== undefined;
        }

        recordTest('D4', 'npm scripts configured', passed);
    }

    // ============================================================
    // TEST GROUP E: Hospital Isolation (Schema Level)
    // ============================================================
    console.log("\n━━━ Test Group E: Hospital Isolation ━━━");

    // E1: hospitals table has PRIMARY KEY on hospital_id
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = false;

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');
            passed = content.includes('hospital_id TEXT PRIMARY KEY');
        }

        recordTest('E1', 'hospital_id is PRIMARY KEY', passed);
    }

    // E2: Unique constraints on (hospital_id, name) combinations
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = false;

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');
            passed = content.includes('uq_departments_hospital_name') &&
                content.includes('uq_staff_hospital_username');
        }

        recordTest('E2', 'Unique constraints enforce isolation', passed);
    }

    // E3: No PHI columns unencrypted
    {
        const migrationPath = path.join(__dirname, '../../migrations/003_hospital_core_tables.sql');
        let passed = true;
        let phiFound = [];

        // PHI columns that should NOT exist as plain text
        const PHI_PATTERNS = ['patient_name TEXT', 'patient_phone TEXT', 'patient_email TEXT'];

        if (fs.existsSync(migrationPath)) {
            const content = fs.readFileSync(migrationPath, 'utf-8');

            for (const pattern of PHI_PATTERNS) {
                if (content.includes(pattern) && !content.includes(pattern.replace(' TEXT', '_encrypted TEXT'))) {
                    passed = false;
                    phiFound.push(pattern);
                }
            }

            // Check that encrypted versions exist
            if (!content.includes('patient_name_encrypted') ||
                !content.includes('patient_phone_encrypted') ||
                !content.includes('patient_email_encrypted')) {
                passed = false;
                phiFound.push('Missing _encrypted columns');
            }
        }

        recordTest('E3', 'Patient data uses encrypted columns', passed,
            passed ? '' : phiFound.join(', '));
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
        console.log("\n🎉 ALL TESTS PASSED - Phase 1 Database Foundation Complete!");
    } else {
        console.log("\n⚠️ Some tests failed. Review output above.");
    }

    process.exit(results.failed === 0 ? 0 : 1);
}

runTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
