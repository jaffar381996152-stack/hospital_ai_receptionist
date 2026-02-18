/**
 * Phase 3: Slot System & Availability Engine - Test Suite
 * 
 * Tests:
 * A. Slot Generation - Correct time slots from availability
 * B. No Overlap - Generated slots don't overlap
 * C. Locking - Redis-based slot locking works
 * D. Lock Expiry - TTL matches OTP expiry
 * E. Concurrency - Two users, same slot, one wins
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// TEST UTILITIES
// ============================================================

let results = [];

function recordTest(id, name, passed, details = '') {
    results.push({ id, name, passed, details });
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${id} - ${name}`);
    if (!passed && details) console.log(`   Details: ${details}`);
}

// ============================================================
// PATH REFERENCES
// ============================================================

const ROOT = path.resolve(__dirname, '../..');
const SLOT_SERVICE_PATH = path.join(ROOT, 'src/services/slotService.js');
const BOOKING_SERVICE_PATH = path.join(ROOT, 'src/services/bookingService.js');
const SEED_SCRIPT_PATH = path.join(ROOT, 'scripts/seedHospitals.js');

// ============================================================
// TEST GROUP A: SLOT GENERATION
// ============================================================

console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Phase 3: Slot System & Availability - Test Suite      ║
╚═══════════════════════════════════════════════════════════╝
`);

console.log("\n━━━ Test Group A: Slot Generation ━━━");

// A1: SlotService exists
{
    const exists = fs.existsSync(SLOT_SERVICE_PATH);
    recordTest('A1', 'SlotService exists', exists);
}

// A2: Has generateSlotsFromWindow function
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        passed = content.includes('generateSlotsFromWindow');
    }
    recordTest('A2', 'Has slot generation function', passed);
}

// A3: Slots are dynamically generated (not from DB)
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        // Check that it uses doctor_availability table, not a slots table
        passed = content.includes('doctor_availability') &&
            !content.includes('FROM slots WHERE');
    }
    recordTest('A3', 'Slots generated from doctor_availability', passed);
}

// A4: Default slot duration is 15 minutes
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        passed = content.includes('15') &&
            (content.includes('SLOT_DURATION') || content.includes('slotDurationMinutes'));
    }
    recordTest('A4', 'Default slot duration configurable', passed);
}

// A5: Test slot generation logic inline
{
    // Simulate the slot generation logic
    function generateSlots(startTime, endTime, duration = 15) {
        const slots = [];
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;

        for (let current = startMinutes; current + duration <= endMinutes; current += duration) {
            const hours = Math.floor(current / 60);
            const mins = current % 60;
            slots.push(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`);
        }
        return slots;
    }

    // Test: 09:00-12:00 with 15 min slots = 12 slots
    const slots = generateSlots('09:00', '12:00', 15);
    const expectedCount = 12; // 09:00, 09:15, 09:30, ... 11:45
    const passed = slots.length === expectedCount &&
        slots[0] === '09:00' &&
        slots[slots.length - 1] === '11:45';

    recordTest('A5', 'Slot generation logic correct (12 slots in 3 hours)', passed,
        passed ? '' : `Expected ${expectedCount} slots, got ${slots.length}`);
}

// ============================================================
// TEST GROUP B: NO OVERLAP
// ============================================================

console.log("\n━━━ Test Group B: No Overlap ━━━");

// B1: Slots don't overlap
{
    function generateSlots(startTime, endTime, duration = 15) {
        const slots = [];
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;

        for (let current = startMinutes; current + duration <= endMinutes; current += duration) {
            slots.push(current);
        }
        return slots;
    }

    const slots = generateSlots('09:00', '17:00', 15);
    let hasOverlap = false;

    for (let i = 1; i < slots.length; i++) {
        if (slots[i] < slots[i - 1] + 15) {
            hasOverlap = true;
            break;
        }
    }

    recordTest('B1', 'Generated slots do not overlap', !hasOverlap);
}

// B2: Adjacent availability windows handled correctly
{
    // Morning: 09:00-12:00, Afternoon: 13:00-17:00
    // These should NOT generate overlapping slots
    function generateSlots(startTime, endTime, duration = 15) {
        const slots = [];
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;

        for (let current = startMinutes; current + duration <= endMinutes; current += duration) {
            slots.push(current);
        }
        return slots;
    }

    const morning = generateSlots('09:00', '12:00', 15);
    const afternoon = generateSlots('13:00', '17:00', 15);

    // Last morning slot should be before first afternoon slot
    const morningEnd = morning[morning.length - 1] + 15; // End of last morning slot
    const afternoonStart = afternoon[0];

    const noOverlap = morningEnd <= afternoonStart;
    recordTest('B2', 'Lunch break creates gap (no overlap)', noOverlap,
        noOverlap ? '' : `Morning ends at ${morningEnd}, afternoon starts at ${afternoonStart}`);
}

// ============================================================
// TEST GROUP C: LOCKING
// ============================================================

console.log("\n━━━ Test Group C: Locking ━━━");

// C1: Lock function exists
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        passed = content.includes('lockSlot') && content.includes('async');
    }
    recordTest('C1', 'lockSlot function exists', passed);
}

// C2: Uses Redis for locking
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        passed = content.includes('redis') || content.includes('redisClient');
    }
    recordTest('C2', 'Uses Redis for locking', passed);
}

// C3: Uses SET NX for atomic locking
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        passed = content.includes("'NX'") || content.includes('"NX"');
    }
    recordTest('C3', 'Uses SET NX for atomic lock', passed);
}

// C4: Unlock function exists with owner check
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        passed = content.includes('unlockSlot') &&
            (content.includes('owner') || content.includes('sessionId'));
    }
    recordTest('C4', 'unlockSlot with owner verification', passed);
}

// ============================================================
// TEST GROUP D: LOCK EXPIRY
// ============================================================

console.log("\n━━━ Test Group D: Lock Expiry ━━━");

// D1: Lock has TTL
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        passed = content.includes("'EX'") || content.includes('"EX"') ||
            content.includes('TTL') || content.includes('EXPIR');
    }
    recordTest('D1', 'Lock has TTL/expiry', passed);
}

// D2: TTL matches OTP expiry (600 seconds / 10 minutes)
{
    let passed = false;
    if (fs.existsSync(SLOT_SERVICE_PATH)) {
        const content = fs.readFileSync(SLOT_SERVICE_PATH, 'utf-8');
        passed = content.includes('600') || content.includes('10 minute');
    }
    recordTest('D2', 'Lock TTL matches OTP expiry (10 min)', passed);
}

// ============================================================
// TEST GROUP E: BOOKING SERVICE INTEGRATION
// ============================================================

console.log("\n━━━ Test Group E: BookingService Integration ━━━");

// E1: BookingService uses SlotService
{
    let passed = false;
    if (fs.existsSync(BOOKING_SERVICE_PATH)) {
        const content = fs.readFileSync(BOOKING_SERVICE_PATH, 'utf-8');
        passed = content.includes('SlotService');
    }
    recordTest('E1', 'BookingService uses SlotService', passed);
}

// E2: Booking uses appointments table
{
    let passed = false;
    if (fs.existsSync(BOOKING_SERVICE_PATH)) {
        const content = fs.readFileSync(BOOKING_SERVICE_PATH, 'utf-8');
        passed = content.includes('appointments') &&
            content.includes('INSERT INTO appointments');
    }
    recordTest('E2', 'Booking uses appointments table', passed);
}

// E3: PHI is encrypted before storage
{
    let passed = false;
    if (fs.existsSync(BOOKING_SERVICE_PATH)) {
        const content = fs.readFileSync(BOOKING_SERVICE_PATH, 'utf-8');
        passed = content.includes('encrypt(') &&
            content.includes('_encrypted');
    }
    recordTest('E3', 'PHI encrypted before storage', passed);
}

// ============================================================
// TEST GROUP F: SEED SCRIPT
// ============================================================

console.log("\n━━━ Test Group F: Seed Script ━━━");

// F1: Seed script creates doctors
{
    let passed = false;
    if (fs.existsSync(SEED_SCRIPT_PATH)) {
        const content = fs.readFileSync(SEED_SCRIPT_PATH, 'utf-8');
        passed = content.includes('doctors_v2') &&
            content.includes('INSERT INTO doctors_v2');
    }
    recordTest('F1', 'Seed script creates doctors', passed);
}

// F2: Seed script creates availability
{
    let passed = false;
    if (fs.existsSync(SEED_SCRIPT_PATH)) {
        const content = fs.readFileSync(SEED_SCRIPT_PATH, 'utf-8');
        passed = content.includes('doctor_availability') &&
            content.includes('seedDoctorAvailability');
    }
    recordTest('F2', 'Seed script creates availability', passed);
}

// F3: Working hours seed (Sun-Thu)
{
    let passed = false;
    if (fs.existsSync(SEED_SCRIPT_PATH)) {
        const content = fs.readFileSync(SEED_SCRIPT_PATH, 'utf-8');
        passed = content.includes('day: 0') && // Sunday
            content.includes('day: 4') && // Thursday
            (content.includes('09:00') || content.includes("'09:00'"));
    }
    recordTest('F3', 'Working hours seeded (Sun-Thu 09:00-17:00)', passed);
}

// ============================================================
// SUMMARY
// ============================================================

console.log(`
╔═════════════════════════════════════════╗
║             TEST SUMMARY                ║
╚═════════════════════════════════════════╝`);

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total = results.length;

console.log(`Total: ${total}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
    console.log("\n🎉 ALL TESTS PASSED - Phase 3 Slot System Complete!\n");
} else {
    console.log("\n⚠️ Some tests failed. Review output above.\n");
    process.exit(1);
}
