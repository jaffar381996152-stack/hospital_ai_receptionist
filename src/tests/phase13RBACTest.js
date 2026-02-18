/**
 * Phase 13: RBAC & Permission Enforcement Test
 * 
 * Strict verification of role-based access control.
 * Uses axios (installed) instead of supertest.
 * 
 * Scenarios:
 * 1. Doctor cannot check-in (403)
 * 2. Doctor can ONLY see own bookings
 * 3. Doctor cannot see other doctors' bookings
 * 4. Reception cannot access other hospital data
 * 5. Tampered request payloads are ignored
 */

const assert = require('assert');
const express = require('express');
const session = require('express-session');
// const bodyParser = require('body-parser'); // Removed: Not in package.json
const axios = require('axios');
const http = require('http');

// MOCK ENV VARS (Must be before requires)
process.env.ENCRYPTION_KEY = '00000000000000000000000000000000'; // 32 chars
process.env.NODE_ENV = 'test';
// Import middleware/routes to test in isolation
let receptionRouter;
const path = require('path');
try {
    // MOCK ENV VARS (Must be before requires)
    process.env.ENCRYPTION_KEY = '00000000000000000000000000000000'; // 32 chars
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long';

    // Mock Dependencies - MUST BE BEFORE ROUTER
    const productionDb = require('../config/productionDb');
    const originalInitDb = productionDb.initializeDatabase;

    // MOCK DB SETUP
    const MOCK_BOOKINGS = [
        { id: 1, hospital_id: 'hospital_A', doctor_id: 101, patient_name_encrypted: 'enc_A', appointment_time: '2026-02-08 10:00:00', status: 'confirmed' },
        { id: 2, hospital_id: 'hospital_A', doctor_id: 102, patient_name_encrypted: 'enc_B', appointment_time: '2026-02-08 11:00:00', status: 'confirmed' },
        { id: 3, hospital_id: 'hospital_B', doctor_id: 201, patient_name_encrypted: 'enc_C', appointment_time: '2026-02-08 12:00:00', status: 'confirmed' }
    ];

    const mockDb = {
        query: async (sql, params) => {
            let results = MOCK_BOOKINGS;

            // Hospital Filter (Assumed 1st param)
            if (params.length > 0) {
                results = results.filter(b => b.hospital_id === params[0]);
            }

            // Doctor Filter
            // If query has 'doctor_id = $X', we enforce it.
            // In the router, doctor enforcement adds the param.
            // We simulate this by checking if any param > 100 matches a doctor ID.
            // This is heuristic but sufficient for testing flow logic.

            // Check if SQL contains doctor_id constraint
            if (sql.includes('doctor_id =')) {
                const doctorIdParam = params.find(p => typeof p === 'number' && p > 100);
                if (doctorIdParam) {
                    results = results.filter(b => b.doctor_id === doctorIdParam);
                }
            }

            return results.map(b => ({
                id: b.id,
                status: b.status,
                appointment_time: b.appointment_time,
                doctor_id: b.doctor_id,
                hospital_id: b.hospital_id,
                doctor_name: 'Dr. Mock',
                department_name: 'General',
                department_id: 1,
                patient_name_encrypted: b.patient_name_encrypted,
                patient_phone_encrypted: 'enc_phone',
                checked_in_at: null,
                checked_in_by: null
            }));
        },
        get: async (sql, params) => {
            const id = params[0];
            const hosp = params[1];
            return MOCK_BOOKINGS.find(b => b.id === id && b.hospital_id === hosp);
        },
        execute: async () => ({ changes: 1 })
    };

    // Patch initializeDatabase
    productionDb.initializeDatabase = async () => mockDb;

    receptionRouter = require(path.join(__dirname, '../routes/receptionRouter'));
} catch (e) {
    console.error('FAILED TO REQUIRE receptionRouter:', e);
    process.exit(1);
}


// ============================================================
// SERVER SETUP
// ============================================================

const app = express();
app.use(express.json()); // Built-in body parser
app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));


// Mock Context & User Injection
app.use((req, res, next) => {
    // Inject Mock User from Header
    if (req.headers['x-mock-user']) {
        req.session.receptionUser = JSON.parse(req.headers['x-mock-user']);
    }
    // Inject Mock Hospital from Header
    req.hospitalId = req.headers['x-hospital-id'] || 'hospital_A';
    next();
});

app.use('/reception', receptionRouter);

// ============================================================
// TEST RUNNER
// ============================================================

async function runTests() {
    console.log('\n📋 RBAC & Permission Enforcement Tests (Axios)\n');
    let passed = 0;
    let failed = 0;
    let server;
    let baseUrl;

    try {
        // Start Server
        await new Promise(resolve => {
            server = app.listen(0, () => {
                baseUrl = `http://localhost:${server.address().port}`;
                resolve();
            });
        });

        // Mock DB
        productionDb.initializeDatabase = async () => mockDb;

        // --------------------------------------------------------
        // TEST 1: Doctor cannot check-in (403)
        // --------------------------------------------------------
        console.log('Test 1: Doctor cannot check-in (403)');
        const doctorUser = JSON.stringify({
            id: 1, hospitalId: 'hospital_A', username: 'dr_house', role: 'doctor', doctorId: 101
        });

        try {
            await axios.post(`${baseUrl}/reception/checkin`, { booking_id: 1 }, {
                headers: { 'x-mock-user': doctorUser, 'x-hospital-id': 'hospital_A' }
            });
            throw new Error('Should have failed with 403');
        } catch (err) {
            if (err.response && err.response.status === 403) {
                console.log('✅ Doctor check-in rejected (403)');
                passed++;
            } else {
                throw err;
            }
        }

        // --------------------------------------------------------
        // TEST 2: Reception CAN check-in
        // --------------------------------------------------------
        console.log('Test 2: Reception can check-in');
        const receptionUser = JSON.stringify({
            id: 2, hospitalId: 'hospital_A', username: 'reception_jane', role: 'reception'
        });

        const res2 = await axios.post(`${baseUrl}/reception/checkin`, { booking_id: 1 }, {
            headers: { 'x-mock-user': receptionUser, 'x-hospital-id': 'hospital_A' }
        });
        assert.strictEqual(res2.data.success, true);
        console.log('✅ Reception check-in allowed');
        passed++;

        // --------------------------------------------------------
        // TEST 3: Doctor sees ONLY own bookings
        // --------------------------------------------------------
        console.log('Test 3: Doctor sees ONLY own bookings');
        const res3 = await axios.get(`${baseUrl}/reception/bookings`, {
            headers: { 'x-mock-user': doctorUser, 'x-hospital-id': 'hospital_A' }
        });
        const bookings3 = res3.data.bookings;
        assert.strictEqual(bookings3.length, 1);
        assert.strictEqual(bookings3[0].doctorId, 101);
        console.log('✅ Doctor restricted to own bookings');
        passed++;

        // --------------------------------------------------------
        // TEST 4: Doctor cannot see other bookings via param tampering
        // --------------------------------------------------------
        console.log('Test 4: Doctor cannot see other bookings via param tampering');
        const res4 = await axios.get(`${baseUrl}/reception/bookings?doctor_id=102`, {
            headers: { 'x-mock-user': doctorUser, 'x-hospital-id': 'hospital_A' }
        });
        const bookings4 = res4.data.bookings;
        // Should STILL return Doc 101 (or empty if ANDed logic makes it impossible), but NEVER Doc 102
        // Our MockDB filters by 101 if present.
        assert.strictEqual(bookings4.length, 1);
        assert.strictEqual(bookings4[0].doctorId, 101);
        console.log('✅ Tampered doctor_id ignored');
        passed++;

        // --------------------------------------------------------
        // TEST 5: Reception cannot access other hospital data
        // --------------------------------------------------------
        console.log('Test 5: Reception cannot access other hospital data');
        try {
            await axios.get(`${baseUrl}/reception/bookings`, {
                headers: { 'x-mock-user': receptionUser, 'x-hospital-id': 'hospital_B' }
            });
            throw new Error('Should have failed with 403');
        } catch (err) {
            if (err.response && err.response.status === 403) {
                console.log('✅ Cross-hospital access blocked (403)');
                passed++;
            } else {
                throw err;
            }
        }

        // --------------------------------------------------------
        // TEST 6: Reception sees ALL hospital bookings
        // --------------------------------------------------------
        console.log('Test 6: Reception sees ALL hospital bookings');
        const res6 = await axios.get(`${baseUrl}/reception/bookings`, {
            headers: { 'x-mock-user': receptionUser, 'x-hospital-id': 'hospital_A' }
        });
        const bookings6 = res6.data.bookings;
        assert.strictEqual(bookings6.length, 2); // Both 101 and 102
        console.log('✅ Reception sees full dashboard');
        passed++;

    } catch (err) {
        console.error('❌ Test Failed:', err.message);
        if (err.response) {
            console.error('   Response:', err.response.data);
            console.error('   Status:', err.response.status);
        }
        failed++;
    } finally {
        // Cleanup
        if (server) server.close();
        productionDb.initializeDatabase = originalInitDb;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));

    if (failed > 0) process.exit(1);
}

runTests();
