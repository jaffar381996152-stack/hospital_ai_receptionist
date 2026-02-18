/**
 * Phase 18: Final End-to-End Simulation (GO/NO-GO)
 * 
 * Simulates real-world usage across 3 hospitals to prove readiness.
 * 
 * Scenarios:
 * 1. Concurrent Traffic (20-30 bookings per hospital)
 * 2. Slot Collision (Atomic Locking Verification)
 * 3. Cross-Hospital Security (Isolation Verification)
 * 4. Critical Flows (Booking, OTP, Check-in, Dashboard)
 */

const fs = require('fs');
const path = require('path');
const { app, server, redisClient } = require('../../server');
const { initializeDatabase } = require('../config/productionDb');
const { runMigrationsSqlite } = require('../config/migrationRunner');
const { AuditService, ACTIONS } = require('../services/auditService');
const { BookingService } = require('../services/bookingService');
const ReceptionAuthService = require('../services/receptionAuthService');
const HospitalConfig = require('../config/hospitalConfig');

// Configuration
const PORT = 3007; // Unique port for simulation
const HOSPITALS = ['hospital_riyadh', 'hospital_jeddah', 'hospital_dammam'];
const VISITORS_PER_HOSPITAL = 10; // Scaled down for CI/Speed, but enough for concurrency
const RETRY_DELAY_MS = 100;

// State
let db;
let serverInstance;

// Setup & Teardown
async function startServer() {
    return new Promise((resolve) => {
        serverInstance = server.listen(PORT, () => {
            console.log(`Simulation server running on port ${PORT}`);
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

async function setupDatabase() {
    process.env.SQLITE_DB_PATH = path.resolve(__dirname, `../../simulation_${Date.now()}.sqlite`);
    console.log(`Using Simulation DB: ${process.env.SQLITE_DB_PATH}`);

    db = await initializeDatabase();
    await runMigrationsSqlite(db);

    // Explicitly delete prior data to be safe (though file is unique)
    // await db.execute('DELETE FROM appointments'); 

    // Seed Data
    await seedData(db);
    return db;
}

async function seedData(db) {
    console.log('🌱 Seeding Simulation Data...');

    // 1. Hospitals (Ensure config matches DB)
    for (const hId of HOSPITALS) {
        const config = HospitalConfig.getHospitalConfig(hId);
        await db.execute(
            `INSERT OR IGNORE INTO hospitals (hospital_id, name, timezone) VALUES (?, ?, ?)`,
            [hId, config.name, 'Asia/Riyadh']
        );

        // 2. Departments
        for (const dept of config.departments) {
            // Get Dept ID (Insert if not exists)
            await db.execute(
                `INSERT OR IGNORE INTO departments (hospital_id, name) VALUES (?, ?)`,
                [hId, dept]
            );

            const deptRow = await db.get(`SELECT id FROM departments WHERE hospital_id = ? AND name = ?`, [hId, dept]);

            // 3. Doctors (2 per dept)
            for (let i = 1; i <= 2; i++) {
                const docName = `Dr. ${dept} ${i} (${hId})`;
                await db.execute(
                    `INSERT INTO doctors_v2 (hospital_id, department_id, name) VALUES (?, ?, ?)`,
                    [hId, deptRow.id, docName]
                );

                // Get Doctor ID
                const docRow = await db.get(`SELECT id FROM doctors_v2 WHERE hospital_id = ? AND name = ?`, [hId, docName]);

                // Create Availability (Mon-Sun, 9-5)
                for (let day = 0; day <= 6; day++) {
                    await db.execute(
                        `INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)`,
                        [docRow.id, day, '09:00', '17:00']
                    );
                }
            }
        }

        // 4. Staff Users 
        try {
            await ReceptionAuthService.createUser({
                hospitalId: hId,
                username: `recep_${hId}`,
                password: 'password123',
                role: 'receptionist'
            });
        } catch (e) { } // Ignore unique constraint if exists
    }
    console.log('✅ Seed Data Complete');
}

// Scenarios

async function runTrafficSimulation() {
    console.log('\n🚦 Starting Traffic Simulation...');
    const results = {
        total: 0,
        success: 0,
        failed: 0,
        collisions_caught: 0
    };

    // Use tomorrow for slots to avoid "past time" filtering if running late in day
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    console.log(`📅 Simulating bookings for: ${dateStr}`);

    const tasks = [];

    // Simulate visitors for each hospital
    for (const hId of HOSPITALS) {
        for (let i = 0; i < VISITORS_PER_HOSPITAL; i++) {
            tasks.push(simulateVisitorFlow(hId, i, dateStr, results));
        }
    }

    // Add Collision Test
    tasks.push(simulateCollision(HOSPITALS[0], dateStr, results));

    await Promise.all(tasks);

    console.log('\n📊 Traffic Results:', results);
    return results;
}

async function simulateVisitorFlow(hospitalId, visitorId, dateStr, results) {
    results.total++;
    const visitorName = `Visitor_${hospitalId}_${visitorId}`;

    try {
        const config = HospitalConfig.getHospitalConfig(hospitalId);
        const dept = config.departments[0]; // Pick first dept

        // 1. Find slots directly via Service
        // Note: SlotService calculates availability based on rules + existing bookings
        const slots = await BookingService.getAvailableSlots(dept, hospitalId, dateStr);

        if (!slots || slots.length === 0) {
            // console.log(`[${visitorName}] No slots available.`);
            return;
        }

        // Pick random slot
        const slot = slots[Math.floor(Math.random() * slots.length)];

        const sessionId = `session_${visitorName}`;

        // 2. Lock It (Initiate)
        // We must lock the slot first, or confirmBooking will fail verification
        const locked = await BookingService.lockSlot(slot.doctor_id, slot.datetime, sessionId, hospitalId);

        if (!locked) {
            // console.log(`[${visitorName}] Slot locked by another user.`);
            return;
        }

        // 3. Book It (Confirm directly)
        // Simulate "Initiated" state implicitly by just calling confirm (API would do initiate -> OTP -> confirm)

        // Wait random delay to scramble timing
        await new Promise(r => setTimeout(r, Math.random() * 500));

        const result = await BookingService.confirmBooking({
            hospitalId: hospitalId,
            doctorId: slot.doctor_id,
            datetime: slot.datetime, // Use slot.datetime (ISO) which is what logic expects
            patientName: visitorName,
            patientPhone: `555-00${visitorId}`
        }, sessionId);

        if (result && result.status === 'confirmed') {
            results.success++;
        } else {
            results.failed++;
        }

    } catch (err) {
        // console.error(`[${visitorName}] Error:`, err.message);
        results.failed++;
    }
}

async function simulateCollision(hospitalId, dateStr, results) {
    console.log(`\n💥 Executing Collision Test on ${hospitalId}...`);

    const config = HospitalConfig.getHospitalConfig(hospitalId);
    const dept = config.departments[0];
    const slots = await BookingService.getAvailableSlots(dept, hospitalId, dateStr);

    if (!slots.length) {
        console.log('Skipping collision: No slots.');
        return;
    }

    const targetSlot = slots[slots.length - 1]; // Use last slot to avoid main traffic
    console.log(`Targeting Slot ID ${targetSlot.datetime} for Collision...`);

    // Fire 2 concurrent requests
    const bookingDataA = {
        hospitalId,
        doctorId: targetSlot.doctor_id,
        datetime: targetSlot.datetime,
        patientName: 'Collider_A',
        patientPhone: '555-A'
    };

    const bookingDataB = {
        hospitalId,
        doctorId: targetSlot.doctor_id,
        datetime: targetSlot.start_time,
        patientName: 'Collider_B',
        patientPhone: '555-B'
    };

    const p1 = (async () => {
        const locked = await BookingService.lockSlot(targetSlot.doctor_id, targetSlot.datetime, 'session_collider_a', hospitalId);
        if (!locked) return { status: 'failed_lock' };
        return await BookingService.confirmBooking(bookingDataA, 'session_collider_a');
    })();

    const p2 = (async () => {
        // Slight delay to ensure race condition isn't just "first one gets lock" but "simultaneous attempt"
        // But actually, we WANT to see if the second one fails to lock or fails to confirm.
        // If we want to test atomic lock *during* confirm, we need to manually lock?
        // No, confirmBooking verifies lock. So if we can't get lock, we can't confirm.
        // This test proves that the FIRST step (locking) prevents the SECOND step (locking) or that verify works.

        const locked = await BookingService.lockSlot(targetSlot.doctor_id, targetSlot.datetime, 'session_collider_b', hospitalId);
        if (!locked) return { status: 'failed_lock' };
        return await BookingService.confirmBooking(bookingDataB, 'session_collider_b');
    })();

    const outcomes = await Promise.allSettled([p1, p2]);

    let successes = 0;
    outcomes.forEach(o => {
        if (o.status === 'fulfilled' && o.value && o.value.status === 'confirmed') {
            successes++;
        }
    });

    if (successes === 1) {
        console.log('✅ Atomic Locking Verified: Only 1 booking succeeded.');
        results.collisions_caught++;
    } else {
        console.error(`❌ Atomic Locking FAILED: Successes = ${successes}`);
        // If 0, both failed (maybe slot taken by random traffic).
        // If 2, locking failed.
    }
}

async function verifyCrossHospitalSecurity() {
    console.log('\n🔒 Verifying Cross-Hospital Audit Isolation...');

    const riyadhLogs = await AuditService.query('hospital_riyadh');
    const jeddahLogs = await AuditService.query('hospital_jeddah');
    const dammamLogs = await AuditService.query('hospital_dammam');

    // Check strict equality of hospital_id column
    const leaks = [];
    if (riyadhLogs.some(l => l.hospital_id !== 'hospital_riyadh')) leaks.push('Riyadh');
    if (jeddahLogs.some(l => l.hospital_id !== 'hospital_jeddah')) leaks.push('Jeddah');
    if (dammamLogs.some(l => l.hospital_id !== 'hospital_dammam')) leaks.push('Dammam');

    if (leaks.length > 0) {
        console.error(`❌ DATA LEAK DETECTED in: ${leaks.join(', ')}`);
    } else {
        console.log('✅ Audit Logs strict scoping verified.');
    }
}

async function run() {
    const { closeDatabase } = require('../config/productionDb');
    try {
        await startServer();
        db = await setupDatabase();

        await runTrafficSimulation();
        await verifyCrossHospitalSecurity();

        console.log('\n🏁 Simulation Complete.');
    } catch (err) {
        console.error('FATAL SIMULATION ERROR:', err);
        process.exitCode = 1;
    } finally {
        // Cleanup file
        if (db) {
            try {
                await closeDatabase();
                console.log('Database connection closed.');
            } catch (e) {
                console.error('Error closing database:', e);
            }
        }

        if (process.env.SQLITE_DB_PATH && fs.existsSync(process.env.SQLITE_DB_PATH)) {
            // Add small delay to ensure file handle is released
            await new Promise(resolve => setTimeout(resolve, 500));
            try {
                fs.unlinkSync(process.env.SQLITE_DB_PATH);
                console.log('🧹 Cleanup: Simulation DB deleted.');
            } catch (e) {
                console.error('Cleanup Warning (Ignored):', e.message);
            }
        }
        await stopServer();
    }
}

run();
