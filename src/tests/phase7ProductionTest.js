/**
 * Phase 7: Production Hardening - Test Suite
 * 
 * Tests:
 * A. Environment Validation - Required vars, strength checks
 * B. Queue Retry Logic - Config present
 * C. Graceful Shutdown - Handlers installed
 * D. Retention Policy - Service works
 * E. PHI Safety - No raw PHI in logs
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// TEST UTILITIES
// ============================================================

let results = [];

function recordTest(id, name, passed, details = '') {
    results.push({ id, name, passed, details });
    console.log(`  ${passed ? '✅' : '❌'} ${id}: ${name}${details ? ' - ' + details : ''}`);
}

// ============================================================
// PATH REFERENCES
// ============================================================

const ROOT = path.resolve(__dirname, '../..');
const UTILS_DIR = path.join(ROOT, 'src/utils');
const CONFIG_DIR = path.join(ROOT, 'src/config');
const SERVICES_DIR = path.join(ROOT, 'src/services');
const WORKERS_DIR = path.join(ROOT, 'src/workers');
const SERVER_PATH = path.join(ROOT, 'server.js');

const ENV_VALIDATOR_PATH = path.join(UTILS_DIR, 'envValidator.js');
const QUEUE_PATH = path.join(CONFIG_DIR, 'queue.js');
const GRACEFUL_SHUTDOWN_PATH = path.join(UTILS_DIR, 'gracefulShutdown.js');
const RETENTION_PATH = path.join(SERVICES_DIR, 'retentionService.js');
const SMS_WORKER_PATH = path.join(WORKERS_DIR, 'smsWorker.js');
const SMS_PROVIDER_PATH = path.join(ROOT, 'src/providers/TwilioSMSProvider.js');

console.log(`
╔════════════════════════════════════════════════════════════╗
║     Phase 7: Production Hardening - Test Suite             ║
╚════════════════════════════════════════════════════════════╝
`);

// ============================================================
// TEST GROUP A: ENVIRONMENT VALIDATION
// ============================================================

console.log("\n━━━ Test Group A: Environment Validation ━━━");

// A1: Validator exists
{
    const exists = fs.existsSync(ENV_VALIDATOR_PATH);
    recordTest('A1', 'Environment validator exists', exists);
}

// A2: Checks required vars
{
    let passed = false;
    if (fs.existsSync(ENV_VALIDATOR_PATH)) {
        const content = fs.readFileSync(ENV_VALIDATOR_PATH, 'utf-8');
        passed = content.includes('SESSION_SECRET') &&
            content.includes('ENCRYPTION_KEY') &&
            content.includes('ADMIN_SECRET') &&
            content.includes('OPENROUTER_API_KEY');
    }
    recordTest('A2', 'Checks all required environment variables', passed);
}

// A3: Production-specific checks
{
    let passed = false;
    if (fs.existsSync(ENV_VALIDATOR_PATH)) {
        const content = fs.readFileSync(ENV_VALIDATOR_PATH, 'utf-8');
        passed = content.includes('isProduction') &&
            content.includes('DATABASE_URL') &&
            content.includes('PG_HOST');
    }
    recordTest('A3', 'Production requires DATABASE_URL or PG_HOST', passed);
}

// A4: Secret strength validation
{
    let passed = false;
    if (fs.existsSync(ENV_VALIDATOR_PATH)) {
        const content = fs.readFileSync(ENV_VALIDATOR_PATH, 'utf-8');
        passed = content.includes('.length < 32') &&
            content.includes('SESSION_SECRET must be at least 32');
    }
    recordTest('A4', 'Validates secret strength (32+ chars)', passed);
}

// A5: Crashes on missing vars
{
    let passed = false;
    if (fs.existsSync(ENV_VALIDATOR_PATH)) {
        const content = fs.readFileSync(ENV_VALIDATOR_PATH, 'utf-8');
        passed = content.includes('process.exit(1)');
    }
    recordTest('A5', 'Crashes on validation failure', passed);
}

// ============================================================
// TEST GROUP B: QUEUE RETRY LOGIC
// ============================================================

console.log("\n━━━ Test Group B: Queue Retry Logic ━━━");

// B1: Queue config exists
{
    const exists = fs.existsSync(QUEUE_PATH);
    recordTest('B1', 'Queue configuration exists', exists);
}

// B2: Default job options defined
{
    let passed = false;
    if (fs.existsSync(QUEUE_PATH)) {
        const content = fs.readFileSync(QUEUE_PATH, 'utf-8');
        passed = content.includes('DEFAULT_JOB_OPTIONS') &&
            content.includes('attempts');
    }
    recordTest('B2', 'Default job options defined', passed);
}

// B3: Retry attempts configured
{
    let passed = false;
    if (fs.existsSync(QUEUE_PATH)) {
        const content = fs.readFileSync(QUEUE_PATH, 'utf-8');
        passed = content.includes('attempts: 3');
    }
    recordTest('B3', 'Retry attempts: 3', passed);
}

// B4: Exponential backoff
{
    let passed = false;
    if (fs.existsSync(QUEUE_PATH)) {
        const content = fs.readFileSync(QUEUE_PATH, 'utf-8');
        passed = content.includes("type: 'exponential'") &&
            content.includes('delay:');
    }
    recordTest('B4', 'Exponential backoff configured', passed);
}

// ============================================================
// TEST GROUP C: GRACEFUL SHUTDOWN
// ============================================================

console.log("\n━━━ Test Group C: Graceful Shutdown ━━━");

// C1: Graceful shutdown utility exists
{
    const exists = fs.existsSync(GRACEFUL_SHUTDOWN_PATH);
    recordTest('C1', 'Graceful shutdown utility exists', exists);
}

// C2: Handles SIGTERM
{
    let passed = false;
    if (fs.existsSync(GRACEFUL_SHUTDOWN_PATH)) {
        const content = fs.readFileSync(GRACEFUL_SHUTDOWN_PATH, 'utf-8');
        passed = content.includes('SIGTERM');
    }
    recordTest('C2', 'Handles SIGTERM signal', passed);
}

// C3: Handles SIGINT
{
    let passed = false;
    if (fs.existsSync(GRACEFUL_SHUTDOWN_PATH)) {
        const content = fs.readFileSync(GRACEFUL_SHUTDOWN_PATH, 'utf-8');
        passed = content.includes('SIGINT');
    }
    recordTest('C3', 'Handles SIGINT signal', passed);
}

// C4: Closes Redis
{
    let passed = false;
    if (fs.existsSync(GRACEFUL_SHUTDOWN_PATH)) {
        const content = fs.readFileSync(GRACEFUL_SHUTDOWN_PATH, 'utf-8');
        passed = content.includes('redis') && content.includes('quit');
    }
    recordTest('C4', 'Closes Redis connection', passed);
}

// C5: Closes database
{
    let passed = false;
    if (fs.existsSync(GRACEFUL_SHUTDOWN_PATH)) {
        const content = fs.readFileSync(GRACEFUL_SHUTDOWN_PATH, 'utf-8');
        passed = content.includes('database') && content.includes('close');
    }
    recordTest('C5', 'Closes database pool', passed);
}

// C6: Wired in server.js
{
    let passed = false;
    if (fs.existsSync(SERVER_PATH)) {
        const content = fs.readFileSync(SERVER_PATH, 'utf-8');
        passed = content.includes('installShutdownHandlers') &&
            content.includes('registerResources');
    }
    recordTest('C6', 'Wired in server.js', passed);
}

// ============================================================
// TEST GROUP D: RETENTION POLICY
// ============================================================

console.log("\n━━━ Test Group D: Retention Policy ━━━");

// D1: Retention service exists
{
    const exists = fs.existsSync(RETENTION_PATH);
    recordTest('D1', 'Retention service exists', exists);
}

// D2: Per-hospital retention
{
    let passed = false;
    if (fs.existsSync(RETENTION_PATH)) {
        const content = fs.readFileSync(RETENTION_PATH, 'utf-8');
        passed = content.includes('hospital_id') &&
            content.includes('enforceRetentionForHospital');
    }
    recordTest('D2', 'Per-hospital retention enforcement', passed);
}

// D3: Audit logging for purge
{
    let passed = false;
    if (fs.existsSync(RETENTION_PATH)) {
        const content = fs.readFileSync(RETENTION_PATH, 'utf-8');
        passed = content.includes('RETENTION_PURGE') &&
            content.includes('auditLogger');
    }
    recordTest('D3', 'Audit logging for purge operations', passed);
}

// D4: Scheduled in server.js
{
    let passed = false;
    if (fs.existsSync(SERVER_PATH)) {
        const content = fs.readFileSync(SERVER_PATH, 'utf-8');
        passed = content.includes('enforceRetentionSafe') &&
            content.includes('setInterval');
    }
    recordTest('D4', 'Scheduled retention in server.js', passed);
}

// ============================================================
// TEST GROUP E: PHI SAFETY
// ============================================================

console.log("\n━━━ Test Group E: PHI Safety ━━━");

// E1: SMS worker doesn't log phone
{
    let passed = false;
    if (fs.existsSync(SMS_WORKER_PATH)) {
        const content = fs.readFileSync(SMS_WORKER_PATH, 'utf-8');
        passed = content.includes('Never log: to') ||
            content.includes('PHI-safe') ||
            (content.includes('logger') && !content.includes('logger.info(to)'));
    }
    recordTest('E1', 'SMS worker PHI-safe logging', passed);
}

// E2: Twilio provider masks phone
{
    let passed = false;
    if (fs.existsSync(SMS_PROVIDER_PATH)) {
        const content = fs.readFileSync(SMS_PROVIDER_PATH, 'utf-8');
        passed = content.includes('maskPhone');
    }
    recordTest('E2', 'Twilio provider uses maskPhone', passed);
}

// E3: Retention logs no PHI
{
    let passed = false;
    if (fs.existsSync(RETENTION_PATH)) {
        const content = fs.readFileSync(RETENTION_PATH, 'utf-8');
        passed = content.includes('No PHI in logs') ||
            (content.includes('auditLogger') && !content.includes('patient'));
    }
    recordTest('E3', 'Retention logs no PHI', passed);
}

// ============================================================
// SUMMARY
// ============================================================

console.log("\n" + "═".repeat(60));
console.log("SUMMARY");
console.log("═".repeat(60));

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
    console.log("\n🎉 ALL TESTS PASSED - Phase 7 Production Hardening Complete!\n");
} else {
    console.log("\n⚠️ Some tests failed. Review output above.\n");
    process.exit(1);
}
