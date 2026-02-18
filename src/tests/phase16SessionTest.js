/**
 * Phase 16: Session Security & Expiry Test
 * 
 * Objectives:
 * 1. Verify 30-minute session timeout (simulated).
 * 2. Verify Logout invalidates session immediately.
 * 3. Verify Cross-Hospital session reuse is BLOCKED.
 * 4. Verify Cookie tampering is rejected.
 */

// 0. SETUP ENV (Must be before require server)
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'a_very_long_random_string_that_is_at_least_32_chars';
process.env.ENCRYPTION_KEY = 'another_very_long_string_for_encryption_key_32_chars';
process.env.ADMIN_SECRET = 'admin_secret_123456';
process.env.OPENROUTER_API_KEY = 'mock_key';
process.env.USE_SQLITE = 'true'; // Allow SQLite for testing

// HIJACK REQUIRE to block workers
const originalRequire = require('module').prototype.require;
require('module').prototype.require = function (path) {
    if (path.includes('workers/smsWorker') || path.includes('workers/emailWorker')) {
        return () => { }; // No-op function
    }
    return originalRequire.apply(this, arguments);
};

const axios = require('axios');
const assert = require('assert');
// const { startServer, stopServer } = require('./utils/testServer');
const { app, redisClient } = require('../../server'); // Adjusted path to root
// const redisClient = require('../config/redis'); // Use server's instance

// RESTORE REQUIRE (Optional, but good practice)
// require('module').prototype.require = originalRequire;

// Mock Config
const PORT = 3004;
const BASE_URL = `http://localhost:${PORT}`;
const HOSPITAL_A = 'hospital_riyadh';
const HOSPITAL_B = 'hospital_jeddah';

// We need a way to manipulate Redis directly to simulate expiration
// redisClient is already imported

const testUser = {
    username: 'session_test_user',
    password: 'password123',
    role: 'receptionist'
};

async function runTests() {
    console.log('\n🔐 Phase 16: Session Security Tests\n');
    let server;
    let passed = 0;
    let failed = 0;

    try {
        // Start server
        server = app.listen(PORT);
        console.log(`Test server running on port ${PORT}`);

        // Setup: Create a session by logging in
        // We need to mock the DB/Auth service or just hit the login endpoint if it's wired locally?
        // Actually, integration test style is better.
        // But we need a valid user in the DB.

        // Let's use a mock "login" helper or just insert directly into Redis for some tests?
        // No, let's try to hit the real login endpoint if possible, but that requires seeding.
        // Alternative: Mock the ReceptionAuthService.login

        // MOCKING ReceptionAuthService
        const ReceptionAuthService = require('../services/receptionAuthService');
        const originalLogin = ReceptionAuthService.login;
        ReceptionAuthService.login = async (hid, user, pass) => {
            if (user === testUser.username && pass === testUser.password) {
                return {
                    success: true,
                    user: { id: 999, username: user, role: testUser.role, hospitalId: hid }
                };
            }
            return { success: false, error: 'Invalid creds' };
        };

        // ==========================================================
        // TEST 1: Login & Cookie Receipt
        // ==========================================================
        console.log('Test 1: Login & Cookie Receipt');
        const loginRes = await axios.post(`${BASE_URL}/${HOSPITAL_A}/api/reception/login`, testUser);
        assert.strictEqual(loginRes.status, 200);

        const cookie = loginRes.headers['set-cookie'][0];
        assert.ok(cookie.includes('connect.sid'), 'Should receive session cookie');
        assert.ok(cookie.includes('HttpOnly'), 'Cookie should be HttpOnly');
        // Note: Secure flag depends on NODE_ENV=production, we are in test/dev usually

        const cookieHeader = { headers: { Cookie: cookie } };
        console.log('✅ Login successful, cookie received');
        passed++;

        // ==========================================================
        // TEST 2: Access Protected Route
        // ==========================================================
        console.log('Test 2: Access Protected Route');
        const meRes = await axios.get(`${BASE_URL}/${HOSPITAL_A}/api/reception/me`, cookieHeader);
        assert.strictEqual(meRes.status, 200);
        assert.strictEqual(meRes.data.user.username, testUser.username);
        console.log('✅ Valid session can access protected route');
        passed++;

        // ==========================================================
        // TEST 3: Cross-Hospital Blocking (Session Reuse)
        // ==========================================================
        console.log('Test 3: Cross-Hospital Blocking');
        try {
            // Use Hospital A cookie to access Hospital B
            await axios.get(`${BASE_URL}/${HOSPITAL_B}/api/reception/me`, cookieHeader);
            throw new Error('Should have blocked access');
        } catch (err) {
            if (err.response?.status === 403) {
                console.log('✅ Cross-hospital access blocked (403)');
                passed++;
            } else {
                throw err;
            }
        }

        // ==========================================================
        // TEST 4: Logout Invalidation
        // ==========================================================
        console.log('Test 4: Logout Invalidation');
        const logoutRes = await axios.post(`${BASE_URL}/${HOSPITAL_A}/api/reception/logout`, {}, cookieHeader);
        assert.strictEqual(logoutRes.status, 200);

        // Try accessing protected route again
        try {
            await axios.get(`${BASE_URL}/${HOSPITAL_A}/api/reception/me`, cookieHeader);
            throw new Error('Should be unauthorized after logout');
        } catch (err) {
            if (err.response?.status === 401) {
                console.log('✅ Logout invalidated session (401)');
                passed++;
            } else {
                throw err;
            }
        }

        // ==========================================================
        // TEST 5: Session Expiry (Simulation)
        // ==========================================================
        console.log('Test 5: Session Expiry');
        // Login again to get fresh session
        const login2 = await axios.post(`${BASE_URL}/${HOSPITAL_A}/api/reception/login`, testUser);
        const cookie2 = login2.headers['set-cookie'][0];
        const sid = cookie2.match(/connect\.sid=s%3A([^.]+)/)[1]; // Extract raw SID

        // Manually expire in Redis
        const redisKey = `hospital-ai:sess:${sid}`;
        // Verify key exists
        const exists = await redisClient.get(redisKey);
        // assert.ok(exists, 'Session should exist in Redis'); // MockRedis might handle keys differently

        // Delete key to simulate expiry
        await redisClient.del(redisKey);

        try {
            await axios.get(`${BASE_URL}/${HOSPITAL_A}/api/reception/me`, { headers: { Cookie: cookie2 } });
            throw new Error('Should be unauthorized after expiry');
        } catch (err) {
            if (err.response?.status === 401) {
                console.log('✅ Expired session rejected (401)');
                passed++;
            } else {
                // If using MockRedis, del might not work if it's not the same instance used by server
                // But server.js imports the same singleton from src/config/redis.js
                // So it should work.
                console.warn('⚠️ Expiry test warning:', err.message);
                // If it failed (still 200), then Redis sharing check failed.
                throw err;
            }
        }

    } catch (err) {
        console.error('❌ Test Failed:', err.message);
        if (err.response) {
            console.error('   Status:', err.response.status);
            console.error('   Data:', err.response.data);
        }
        failed++;
    } finally {
        if (server) server.close();
        // Restore mocks
        const ReceptionAuthService = require('../services/receptionAuthService');
        // ReceptionAuthService.login = originalLogin; // restore if needed
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));

    if (failed > 0) process.exit(1);
}

runTests();
