/**
 * Phase 17: Audit Log Completeness Test (Integration)
 * 
 * Verifies that key business actions trigger audit logs in the DB.
 * 
 * Scenarios:
 * 1. Booking Creation -> Audit Log
 * 2. Booking Confirmation -> Audit Log
 * 3. Booking Cancellation -> Audit Log
 * 4. Staff Login -> Audit Log
 * 5. Staff Logout -> Audit Log
 * 6. Patient Check-in -> Audit Log
 * 
 * Checks:
 * - existence of log
 * - correct action type
 * - correct hospital_id
 * - no PHI in metadata
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { app, server, redisClient } = require('../../server'); // Ensure server exports
const { AuditService, ACTIONS, ENTITY_TYPES } = require('../services/auditService');
const { initializeDatabase } = require('../config/productionDb');
const { runMigrationsSqlite } = require('../config/migrationRunner');
const { BookingService } = require('../services/bookingService'); // Direct service call for some tests if API is complex
const ReceptionAuthService = require('../services/receptionAuthService'); // Direct auth helper

// Setup
const PORT = 3006; // Use a different port if needed
const BASE_URL = `http://localhost:${PORT}`;

// Test Data
const HOSPITAL_ID = 'hospital_riyadh';
const DOCTOR_ID = 1; // Assuming exists from seed
const DEPARTMENT = 'Cardiology'; // Assuming exists

// Mock User
const TEST_USER = {
    username: 'audit_test_user',
    password: 'password123',
    role: 'receptionist'
};

// Start Server
let serverInstance;

async function startServer() {
    return new Promise((resolve) => {
        serverInstance = server.listen(PORT, () => {
            console.log(`Test server running on port ${PORT}`);
            resolve();
        });
    });
}

async function stopServer() {
    return new Promise((resolve) => {
        if (redisClient) {
            if (redisClient.quit) redisClient.quit();
            else if (redisClient.disconnect) redisClient.disconnect();
        }
        serverInstance.close(() => resolve());
    });
}

// Helpers
async function getLatestAuditLog(action, entityId = null) {
    const db = await initializeDatabase();
    const useSqlite = process.env.USE_SQLITE === 'true';

    let sql = `SELECT * FROM audit_logs WHERE action = '${action}'`;
    if (entityId) {
        sql += ` AND (entity_id = '${entityId}' OR entity_id = '${entityId}.0')`;
    }
    sql += ` ORDER BY id DESC LIMIT 1`;

    // Simple wait/retry loop as audit logging is async/fire-and-forget
    for (let i = 0; i < 10; i++) {
        const row = await db.get(sql);
        if (row) return row;
        await new Promise(r => setTimeout(r, 200)); // Wait 200ms
    }

    // Debug: Dump logs if not found
    const allLogs = await db.query('SELECT * FROM audit_logs');
    console.log('DEBUG: All Audit Logs:', allLogs);

    return null;
}

async function runTests() {
    process.env.SQLITE_DB_PATH = path.resolve(__dirname, `../../test_audit_${Date.now()}.sqlite`);
    console.log('Starting Phase 17 Audit Completeness Tests using DB:', process.env.SQLITE_DB_PATH);

    try {
        await startServer();

        // Seed Test Data for FK constraints
        const db = await initializeDatabase();

        // Run migrations for fresh DB
        await runMigrationsSqlite(db);

        // Cleanup old data
        await db.execute('DELETE FROM appointments');
        await db.execute('DELETE FROM audit_logs');

        // Seed Hospital
        await db.execute(`INSERT OR IGNORE INTO hospitals (hospital_id, name) VALUES (?, ?)`, [HOSPITAL_ID, 'Test Hospital']);

        // Debug Schema
        const schema = await db.query("SELECT sql FROM sqlite_master WHERE name='appointments'");
        console.log('appointments Schema SQL:', schema);

        // Seed Department
        await db.execute(`INSERT OR IGNORE INTO departments (id, hospital_id, name) VALUES (1, ?, ?)`, [HOSPITAL_ID, DEPARTMENT]);
        // Seed Doctor
        await db.execute(`INSERT OR IGNORE INTO doctors_v2 (id, hospital_id, department_id, name) VALUES (?, ?, 1, 'Dr. Audit')`, [DOCTOR_ID, HOSPITAL_ID]);
        console.log('✅ Seed Data Created');

        // 1. Staff Login Audit
        console.log('\nTEST 1: Staff Login Audit');
        // Create user first
        await ReceptionAuthService.createUser({
            hospitalId: HOSPITAL_ID,
            username: TEST_USER.username,
            password: TEST_USER.password,
            role: TEST_USER.role
        });

        // Perform Login via API
        const loginRes = await axios.post(`${BASE_URL}/${HOSPITAL_ID}/api/reception/login`, {
            username: TEST_USER.username,
            password: TEST_USER.password
        });
        assert.strictEqual(loginRes.data.success, true);

        // Verify Log
        const loginLog = await getLatestAuditLog(ACTIONS.STAFF_LOGIN, TEST_USER.username);
        assert.ok(loginLog, 'Login audit log should exist');
        assert.strictEqual(loginLog.hospital_id, HOSPITAL_ID);
        console.log('✅ Staff Login Logged');

        const sessionCookie = loginRes.headers['set-cookie'][0];


        // 2. Booking Creation Audit (Initiate)
        console.log('\nTEST 2: Booking Creation Audit');
        // Create via Service (easier than mocking full chat flow)
        const sessionId = 'audit-test-session-' + Date.now();
        const bookingData = {
            hospitalId: HOSPITAL_ID,
            doctorId: DOCTOR_ID,
            datetime: '2026-12-31 10:00:00', // Future date
            patientName: 'Audit Test Patient',
            patientPhone: '5551234567',
            patientEmail: 'audit@test.com'
        };

        const initResult = await BookingService.initiateBooking(bookingData, sessionId);
        assert.strictEqual(initResult.success, true);
        const bookingId = initResult.booking.id;

        const createLog = await getLatestAuditLog(ACTIONS.BOOKING_CREATED, bookingId);
        assert.ok(createLog, 'Booking creation log should exist');
        assert.strictEqual(createLog.hospital_id, HOSPITAL_ID);
        // Verify NO PHI
        const metadata = JSON.parse(createLog.metadata || '{}');
        assert.strictEqual(metadata.patient_name, undefined, 'Metadata should NOT have PHI');
        console.log('✅ Booking Creation Logged (No PHI)');


        // 3. Booking Confirmation Audit
        console.log('\nTEST 3: Booking Confirmation Audit');
        // Manually confirm via Service
        const confirmResult = await BookingService.confirmBooking(initResult.booking, sessionId);
        assert.ok(confirmResult, 'Booking should confirm');
        const appointmentId = confirmResult.id;

        const confirmLog = await getLatestAuditLog(ACTIONS.BOOKING_CONFIRMED, appointmentId.toString()); // entityId matches appointmentId
        assert.ok(confirmLog, 'Booking confirmation log should exist');
        // Handle SQLite .0 suffix
        const entityId = confirmLog.entity_id;
        assert.ok(entityId === appointmentId.toString() || entityId === `${appointmentId}.0`, `Entity ID ${entityId} should match ${appointmentId}`);
        console.log('✅ Booking Confirmation Logged');


        // 4. Patient Check-in Audit
        console.log('\nTEST 4: Patient Check-in Audit');
        // Perform via API (Reception role)
        const checkinRes = await axios.post(`${BASE_URL}/${HOSPITAL_ID}/api/reception/checkin`, {
            booking_id: appointmentId
        }, {
            headers: { Cookie: sessionCookie }
        });
        assert.strictEqual(checkinRes.data.success, true);

        const checkinLog = await getLatestAuditLog(ACTIONS.PATIENT_CHECKED_IN, appointmentId.toString());
        assert.ok(checkinLog, 'Check-in log should exist');
        assert.strictEqual(checkinLog.performed_by, TEST_USER.username);
        console.log('✅ Patient Check-in Logged');


        // 5. Booking Cancellation Audit
        console.log('\nTEST 5: Booking Cancellation Audit');
        // Create another booking to cancel
        const booking2Data = { ...bookingData, datetime: '2026-12-31 11:00:00' };
        const initResult2 = await BookingService.initiateBooking(booking2Data, sessionId);
        const bookingId2 = initResult2.booking.id;

        // Cancel via Service
        await BookingService.cancelBooking(bookingId2, sessionId, 'Audit Test Cancel');

        const cancelLog = await getLatestAuditLog(ACTIONS.BOOKING_CANCELLED, bookingId2);
        assert.ok(cancelLog, 'Cancellation log should exist');
        const cancelMeta = JSON.parse(cancelLog.metadata || '{}');
        assert.strictEqual(cancelMeta.reason, 'Audit Test Cancel');
        console.log('✅ Booking Cancellation Logged');


        // 6. Staff Logout Audit
        console.log('\nTEST 6: Staff Logout Audit');
        const logoutRes = await axios.post(`${BASE_URL}/${HOSPITAL_ID}/api/reception/logout`, {}, {
            headers: { Cookie: sessionCookie }
        });
        assert.strictEqual(logoutRes.data.success, true);

        const logoutLog = await getLatestAuditLog(ACTIONS.STAFF_LOGOUT, TEST_USER.username);
        assert.ok(logoutLog, 'Logout log should exist');
        console.log('✅ Staff Logout Logged');

        console.log('\n🎉 ALL PHASE 17 AUDIT TESTS PASSED');
        process.exit(0);

    } catch (err) {
        console.error('\n❌ TEST FAILED');
        console.error(err);
        process.exit(1);
    } finally {
        await stopServer();
        // Cleanup test DB
        if (process.env.SQLITE_DB_PATH && fs.existsSync(process.env.SQLITE_DB_PATH)) {
            try {
                fs.unlinkSync(process.env.SQLITE_DB_PATH);
            } catch (e) { console.error('Failed to cleanup DB:', e.message); }
        }
    }
}

// Run
runTests();
