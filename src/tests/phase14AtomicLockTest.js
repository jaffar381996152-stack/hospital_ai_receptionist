/**
 * Phase 14: Atomic Slot Locking & Concurrency Test
 * 
 * Objectives:
 * 1. PROVE that double bookings are impossible (Race Conditions).
 * 2. Verify Atomic Locking via Redis (SET NX).
 * 3. Verify TTL Expiry (Crash Recovery).
 */

const assert = require('assert');
const SlotService = require('../services/slotService');
const redisClient = require('../config/redis');

// Mock Data
const HOSPITAL_ID = 'hospital_concurrency_test';
const DOCTOR_ID = 999;
const SLOT_TIME = '2026-12-31T10:00:00'; // Future date
const SESSION_A = 'session_user_a';
const SESSION_B = 'session_user_b';

// Helper: Clear test keys
async function clearTestKeys() {
    const key = `slotlock:${HOSPITAL_ID}:${DOCTOR_ID}:${SLOT_TIME}`;
    if (redisClient.del) {
        await redisClient.del(key);
    }
}

async function runTests() {
    console.log('\n🔒 Phase B: Atomic Slot Locking Tests\n');
    let passed = 0;
    let failed = 0;

    try {
        // Ensure clean state
        await clearTestKeys();

        // ==========================================================
        // TEST 1: Basic Locking
        // ==========================================================
        console.log('Test 1: Basic Locking (SET NX)');
        const lockedA = await SlotService.lockSlot(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME, SESSION_A);
        assert.strictEqual(lockedA, true, 'First lock attempt should succeed');

        const isLocked = await SlotService.isSlotLocked(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME);
        assert.strictEqual(isLocked, SESSION_A, 'Slot should be locked by Session A');

        console.log('✅ Basic locking confirmed');
        passed++;

        // ==========================================================
        // TEST 2: Prevent Double Locking (Sequential)
        // ==========================================================
        console.log('Test 2: Prevent Second Lock (Sequential)');
        const lockedB = await SlotService.lockSlot(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME, SESSION_B);
        assert.strictEqual(lockedB, false, 'Second lock attempt MUST fail');

        console.log('✅ Sequential double locking prevented');
        passed++;

        // ==========================================================
        // TEST 3: Atomic Release
        // ==========================================================
        console.log('Test 3: Atomic Release (Owner Only)');
        // Try unlocking with wrong session
        const unlockedB = await SlotService.unlockSlot(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME, SESSION_B);
        assert.strictEqual(unlockedB, false, 'Wrong session cannot unlock');

        const stillLocked = await SlotService.isSlotLocked(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME);
        assert.strictEqual(stillLocked, SESSION_A, 'Lock should persist');

        // Unlock with correct session
        const unlockedA = await SlotService.unlockSlot(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME, SESSION_A);
        assert.strictEqual(unlockedA, true, 'Owner should be able to unlock');

        const isLockedAfter = await SlotService.isSlotLocked(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME);
        assert.strictEqual(isLockedAfter, null, 'Slot should be free');

        console.log('✅ Safe unlocking verification passed');
        passed++;

        // ==========================================================
        // TEST 4: Race Condition Simulation (Concurrency)
        // ==========================================================
        console.log('Test 4: Race Condition (Parallel Locking)');
        await clearTestKeys(); // Reset

        // Simulate 20 parallel requests exactly at the same time
        const CONCURRENT_REQUESTS = 20;
        const promises = [];

        for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
            promises.push(SlotService.lockSlot(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME, `session_race_${i}`));
        }

        const results = await Promise.all(promises);
        const successCount = results.filter(r => r === true).length;
        const failCount = results.filter(r => r === false).length;

        console.log(`   Attempts: ${CONCURRENT_REQUESTS}`);
        console.log(`   Successes: ${successCount}`);
        console.log(`   Failures: ${failCount}`);

        assert.strictEqual(successCount, 1, 'EXACTLY ONE request should succeed');
        assert.strictEqual(failCount, CONCURRENT_REQUESTS - 1, 'All other requests should fail');

        console.log('✅ Race condition handled perfectly (Atomic Guarantee)');
        passed++;

        // ==========================================================
        // TEST 5: TTL / Crash Recovery
        // ==========================================================
        console.log('Test 5: Crash Recovery (TTL Simulation)');
        // Manually set a lock with short TTL to simulate "crash" where app dies but Redis keeps key
        const SHORT_TTL = 2; // seconds
        const lockKey = `slotlock:${HOSPITAL_ID}:${DOCTOR_ID}:${SLOT_TIME}`;

        await redisClient.set(lockKey, 'crashed_session', 'EX', SHORT_TTL);
        assert.strictEqual(await SlotService.isSlotLocked(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME), 'crashed_session');

        console.log(`   Simulating crash (waiting ${SHORT_TTL + 1}s for TTL expiry)...`);
        await new Promise(resolve => setTimeout(resolve, (SHORT_TTL + 1) * 1000));

        const lockAfterCrash = await SlotService.isSlotLocked(HOSPITAL_ID, DOCTOR_ID, SLOT_TIME);
        assert.strictEqual(lockAfterCrash, null, 'Lock should auto-release after TTL');

        console.log('✅ Crash recovery verified (TTL works)');
        passed++;

    } catch (err) {
        console.error('❌ Test Failed:', err);
        failed++;
    } finally {
        // Cleanup
        await clearTestKeys();
        if (redisClient.quit) await redisClient.quit(); // Close connection
    }

    console.log('\n' + '='.repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));

    if (failed > 0) process.exit(1);
}

runTests();
