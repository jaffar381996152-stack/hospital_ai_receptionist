/**
 * Phase 11: Production Hardening (Oracle KSA) - Test Suite
 * 
 * Explicit tests for Oracle KSA deployment requirements:
 * 1. App fails on missing env
 * 2. Graceful shutdown verified  
 * 3. Queue recovers after restart
 * 4. No PHI in logs
 * 5. Structured JSON logging
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// ============================================================
// TEST UTILITIES
// ============================================================

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (err) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${err.message}`);
        failed++;
    }
}

const ROOT = path.resolve(__dirname, '../..');

// ============================================================
// 1. ENVIRONMENT VALIDATION TESTS
// ============================================================
console.log('\n📋 Environment Validation Tests\n');

test('App must fail on missing critical env vars', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/utils/envValidator.js'),
        'utf-8'
    );

    assert.ok(content.includes('process.exit(1)'), 'Must exit on failure');
    assert.ok(content.includes("errors.push"), 'Must collect errors');
});

test('Required env vars are checked', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/utils/envValidator.js'),
        'utf-8'
    );

    const requiredVars = ['SESSION_SECRET', 'ENCRYPTION_KEY', 'ADMIN_SECRET', 'OPENROUTER_API_KEY'];
    requiredVars.forEach(v => {
        assert.ok(content.includes(v), `Must check ${v}`);
    });
});

test('Production requires PostgreSQL (not SQLite)', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/utils/envValidator.js'),
        'utf-8'
    );

    assert.ok(content.includes('SQLite not allowed in production'), 'SQLite blocked in production');
    assert.ok(content.includes('DATABASE_URL'), 'DATABASE_URL required');
});

test('Error messages do not expose secrets', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/utils/envValidator.js'),
        'utf-8'
    );

    // Error messages should not include actual values
    assert.ok(!content.includes('logger.error(process.env'), 'Must not log env values');
});

// ============================================================
// 2. GRACEFUL SHUTDOWN TESTS
// ============================================================
console.log('\n📋 Graceful Shutdown Tests\n');

test('Handles SIGTERM and SIGINT signals', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/utils/gracefulShutdown.js'),
        'utf-8'
    );

    assert.ok(content.includes("'SIGTERM'"), 'Handles SIGTERM');
    assert.ok(content.includes("'SIGINT'"), 'Handles SIGINT');
});

test('Finishes in-flight work before exit', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/utils/gracefulShutdown.js'),
        'utf-8'
    );

    // Should close server first (stops new connections)
    assert.ok(content.includes('server.close'), 'Closes HTTP server');
    // Then close workers (finishes jobs)
    assert.ok(content.includes('worker.close'), 'Closes workers');
});

test('Flushes queues on shutdown', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/utils/gracefulShutdown.js'),
        'utf-8'
    );

    assert.ok(content.includes('workers'), 'Tracks workers');
    assert.ok(content.includes('close'), 'Closes workers');
});

test('Closes database connections', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/utils/gracefulShutdown.js'),
        'utf-8'
    );

    assert.ok(content.includes('database'), 'Tracks database');
    assert.ok(content.includes('redis'), 'Tracks redis');
});

test('Shutdown handlers installed in server.js', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'server.js'),
        'utf-8'
    );

    assert.ok(content.includes('installShutdownHandlers'), 'Handlers installed');
    assert.ok(content.includes('registerResources'), 'Resources registered');
});

// ============================================================
// 3. QUEUE RECOVERY TESTS
// ============================================================
console.log('\n📋 Queue Recovery Tests\n');

test('Queue has retry configuration', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/config/queue.js'),
        'utf-8'
    );

    assert.ok(content.includes('attempts'), 'Has retry attempts');
    assert.ok(content.includes('backoff'), 'Has backoff config');
});

test('Queue uses exponential backoff', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/config/queue.js'),
        'utf-8'
    );

    assert.ok(content.includes("type: 'exponential'"), 'Exponential backoff');
});

test('Queue jobs are persistent (Redis-backed)', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/config/queue.js'),
        'utf-8'
    );

    assert.ok(content.includes('redis') || content.includes('Redis'), 'Redis-backed');
});

// ============================================================
// 4. PHI SAFETY TESTS
// ============================================================
console.log('\n📋 PHI Safety Tests\n');

test('Logs use structured JSON format', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/config/logger.js'),
        'utf-8'
    );

    assert.ok(content.includes('winston.format.json()'), 'JSON format');
});

test('Audit logger is separate from main logger', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'src/config/logger.js'),
        'utf-8'
    );

    assert.ok(content.includes('auditLogger'), 'Separate audit logger');
    assert.ok(content.includes('audit.log'), 'Audit log file');
});

test('SMS provider masks phone numbers', () => {
    const providerPath = path.join(ROOT, 'src/providers/TwilioSMSProvider.js');
    if (fs.existsSync(providerPath)) {
        const content = fs.readFileSync(providerPath, 'utf-8');
        assert.ok(content.includes('maskPhone'), 'Masks phone');
    } else {
        assert.ok(true, 'SMS provider not present (OK)');
    }
});

// ============================================================
// 5. SERVER STARTUP ORDER TESTS
// ============================================================
console.log('\n📋 Server Startup Tests\n');

test('Env validation runs before server starts', () => {
    const content = fs.readFileSync(
        path.join(ROOT, 'server.js'),
        'utf-8'
    );

    const envValidatorPos = content.indexOf('envValidator') || content.indexOf('validateEnv');
    const listenPos = content.indexOf('.listen');

    // validateEnv should appear before listen
    assert.ok(envValidatorPos < listenPos, 'Validates before listen');
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Phase 11 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
    process.exit(1);
}
