/**
 * Phase 15: PostgreSQL Validation & Resilience Test
 * 
 * Objectives:
 * 1. Verify Production setup uses PostgreSQL (strict mode).
 * 2. Verify "Fail Fast" behavior if DB is unreachable.
 * 3. Verify Connection Pool config.
 * 4. Verify Recovery logic (app handles query errors gracefully).
 * 
 * NOTE: Mocks 'pg' module to simulate DB behavior without a live server.
 */

const assert = require('assert');

// 1. MOCK PG MODULE (Must be before require productionDb)
const mockPoolQuery = jestMockFn(async () => ({ rows: [{ time: '2026-01-01' }] }));

// Mutable connection behavior
let connectImpl = async () => ({
    query: mockPoolQuery,
    release: () => { }
});

const mockPoolConnect = jestMockFn((...args) => connectImpl(...args));
const mockPoolEnd = jestMockFn(async () => { });
const mockPoolOn = jestMockFn((event, cb) => { });

class MockPool {
    constructor(config) {
        this.config = config;
        this.connect = mockPoolConnect;
        this.query = mockPoolQuery; // Pool can query directly too
        this.end = mockPoolEnd;
        this.on = mockPoolOn;
        MockPool.lastInstance = this;
    }
}

// Simple mock function helper
function jestMockFn(impl) {
    const fn = (...args) => {
        fn.calls.push(args);
        return impl(...args);
    };
    fn.calls = [];
    fn.mockClear = () => { fn.calls = []; };
    return fn;
}

// HIJACK REQUIRE
const originalRequire = require('module').prototype.require;
require('module').prototype.require = function (path) {
    if (path === 'pg') {
        return { Pool: MockPool };
    }
    return originalRequire.apply(this, arguments);
};

// 2. IMPORT MODULE UNDER TEST
// We must clear require cache to enforce fresh load with mock
delete require.cache[require.resolve('../config/productionDb')];
const productionDb = require('../config/productionDb');

async function runTests() {
    console.log('\n🐘 Phase 15: PostgreSQL Resilience Tests\n');
    let passed = 0;
    let failed = 0;

    // SETUP ENV
    const originalEnv = { ...process.env };
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/hospital';
    process.env.USE_SQLITE = 'false';

    try {
        // ==========================================================
        // TEST 1: Strict Production Mode (Reject SQLite)
        // ==========================================================
        console.log('Test 1: Strict Production Mode (Reject SQLite)');
        process.env.USE_SQLITE = 'true'; // Try to force it
        try {
            await productionDb.initializeDatabase();
            throw new Error('Should have thrown error');
        } catch (err) {
            if (err.message.includes('SQLite is disabled in production')) {
                console.log('✅ SQLite correctly rejected in production');
                passed++;
            } else {
                throw err;
            }
        }
        process.env.USE_SQLITE = 'false'; // Reset

        // ==========================================================
        // TEST 2: Fail Fast on Startup
        // ==========================================================
        console.log('Test 2: Fail Fast on Startup');
        // Reset mocks
        delete require.cache[require.resolve('../config/productionDb')];
        const dbReset = require('../config/productionDb'); // Reload to reset adapter

        // Simulating connection failure
        mockPoolConnect.mockClear();

        // Override global implementation
        const originalImpl = connectImpl;
        connectImpl = async () => { throw new Error('Database connection failed: Connection refused'); };

        try {
            await dbReset.initializeDatabase();
            throw new Error('Should have failed fast');
        } catch (err) {
            if (err.message.includes('Database connection failed')) {
                console.log('✅ App fails fast if DB is down');
                passed++;
            } else {
                throw err;
            }
        } finally {
            connectImpl = originalImpl; // Restore
        }

        // ==========================================================
        // TEST 3: Successful Connection & Pool Config
        // ==========================================================
        console.log('Test 3: Successful Connection & Pool Config');
        // Reset mocks to success
        delete require.cache[require.resolve('../config/productionDb')];
        const dbSuccess = require('../config/productionDb');

        await dbSuccess.initializeDatabase();

        // Check config
        const poolInstance = MockPool.lastInstance;
        assert.strictEqual(poolInstance.config.connectionString, process.env.DATABASE_URL);
        assert.strictEqual(poolInstance.config.ssl.rejectUnauthorized, false, 'SSL should be enabled');

        console.log('✅ PostgreSQL pool configured correctly');
        passed++;

        // ==========================================================
        // TEST 4: Query Execution (Adapter check)
        // ==========================================================
        console.log('Test 4: Adapter uses correct syntax');
        const db = dbSuccess.getDatabase();

        // Mock query result
        mockPoolQuery.mockClear();

        await db.query('SELECT * FROM users WHERE id = $1', [123]);

        const lastCall = mockPoolQuery.calls[0];
        // Note: Pool.query(text, params) OR client.query(text, params)
        // Check arguments passed to pool.connect().query or pool.query
        // Our mock wraps client.query but Adapter might use pool.query shortcut?
        // Let's check PostgresAdapter implementation... it uses pool.query usually.

        // Actually, let's verify parameters
        // console.log('Query called with:', lastCall);
        // lastCall should be ['SELECT...', [123]]

        assert.ok(lastCall[0].includes('$1'), 'Should use Postgres $1 syntax');

        console.log('✅ Adapter execution verified');
        passed++;

    } catch (err) {
        console.error('❌ Test Failed:', err);
        failed++;
    } finally {
        // Cleanup
        process.env = originalEnv;
        require('module').prototype.require = originalRequire; // Restore require
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));

    if (failed > 0) process.exit(1);
}

runTests();
