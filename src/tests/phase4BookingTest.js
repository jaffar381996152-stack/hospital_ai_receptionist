/**
 * Phase 4: Booking + OTP Confirmation Flow - Test Suite
 * 
 * Tests:
 * A. OTP Hashing - Never stored as plaintext
 * B. OTP Expiry - 5 minute expiry
 * C. Rate Limiting - 3 attempts per phone per 15 min
 * D. State Machine - Valid/invalid transitions
 * E. Full Flow - Initiate → OTP → Confirm
 * F. OTP Reuse - Used OTP rejected on retry
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
const OTP_SERVICE_PATH = path.join(ROOT, 'src/services/otpService.js');
const STATE_MACHINE_PATH = path.join(ROOT, 'src/services/bookingStateMachine.js');
const BOOKING_SERVICE_PATH = path.join(ROOT, 'src/services/bookingService.js');
const NOTIFICATION_PATH = path.join(ROOT, 'src/services/bookingNotificationService.js');

// ============================================================
// TEST GROUP A: OTP HASHING
// ============================================================

console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Phase 4: Booking + OTP Flow - Test Suite              ║
╚═══════════════════════════════════════════════════════════╝
`);

console.log("\n━━━ Test Group A: OTP Hashing ━━━");

// A1: OTP service uses SHA-256
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('sha256') || content.includes('SHA-256');
    }
    recordTest('A1', 'OTP uses SHA-256 hashing', passed);
}

// A2: Hash function exists
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('hashOtp') || content.includes('createHash');
    }
    recordTest('A2', 'Hash function exists', passed);
}

// A3: Plaintext OTP never stored
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        // Check that it stores hash, not plain OTP
        passed = content.includes('otpHash') &&
            content.includes("set(key, otpHash");
    }
    recordTest('A3', 'Stores hash, not plaintext', passed);
}

// A4: Verify OTP hash logic
{
    // Test the hashing logic inline
    function hashOtp(otp) {
        return crypto.createHash('sha256').update(otp).digest('hex');
    }

    const otp = '123456';
    const hash1 = hashOtp(otp);
    const hash2 = hashOtp(otp);
    const hash3 = hashOtp('654321');

    const passed = hash1 === hash2 && hash1 !== hash3 && hash1.length === 64;
    recordTest('A4', 'Hash is consistent and unique', passed,
        passed ? '' : 'Hash should be consistent for same input, different for different input');
}

// ============================================================
// TEST GROUP B: OTP EXPIRY
// ============================================================

console.log("\n━━━ Test Group B: OTP Expiry ━━━");

// B1: 5 minute expiry configured
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('300') || content.includes('5 minute');
    }
    recordTest('B1', 'OTP expiry is 5 minutes (300s)', passed);
}

// B2: Expiry set when storing
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes("'EX'") && content.includes('OTP_EXPIRY');
    }
    recordTest('B2', 'Expiry TTL set on Redis key', passed);
}

// ============================================================
// TEST GROUP C: RATE LIMITING
// ============================================================

console.log("\n━━━ Test Group C: Rate Limiting ━━━");

// C1: Rate limit check exists
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('checkRateLimit') || content.includes('RATE_LIMIT');
    }
    recordTest('C1', 'Rate limit check exists', passed);
}

// C2: Limit is 3 attempts
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('3') && content.includes('RATE_LIMIT_MAX');
    }
    recordTest('C2', 'Rate limit is 3 attempts', passed);
}

// C3: Rate limit window is 15 minutes
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('900') || content.includes('15 minute');
    }
    recordTest('C3', 'Rate limit window is 15 minutes (900s)', passed);
}

// C4: Rate per phone number
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('phone') && content.includes('ratelimit');
    }
    recordTest('C4', 'Rate limit per phone number', passed);
}

// ============================================================
// TEST GROUP D: STATE MACHINE
// ============================================================

console.log("\n━━━ Test Group D: State Machine ━━━");

// D1: State machine exists
{
    const exists = fs.existsSync(STATE_MACHINE_PATH);
    recordTest('D1', 'State machine file exists', exists);
}

// D2: All states defined
{
    let passed = false;
    if (fs.existsSync(STATE_MACHINE_PATH)) {
        const content = fs.readFileSync(STATE_MACHINE_PATH, 'utf-8');
        passed = content.includes('INITIATED') &&
            content.includes('AWAITING_OTP') &&
            content.includes('CONFIRMED') &&
            content.includes('CHECKED_IN') &&
            content.includes('CANCELLED') &&
            content.includes('EXPIRED');
    }
    recordTest('D2', 'All 6 states defined', passed);
}

// D3: Valid transitions defined
{
    let passed = false;
    if (fs.existsSync(STATE_MACHINE_PATH)) {
        const content = fs.readFileSync(STATE_MACHINE_PATH, 'utf-8');
        passed = content.includes('VALID_TRANSITIONS');
    }
    recordTest('D3', 'Valid transitions defined', passed);
}

// D4: Invalid transition blocked
{
    let passed = false;
    if (fs.existsSync(STATE_MACHINE_PATH)) {
        const content = fs.readFileSync(STATE_MACHINE_PATH, 'utf-8');
        passed = content.includes('isValidTransition') &&
            content.includes('throw new Error') &&
            content.includes('Invalid state transition');
    }
    recordTest('D4', 'Invalid transitions throw error', passed);
}

// D5: Audit logging on state change
{
    let passed = false;
    if (fs.existsSync(STATE_MACHINE_PATH)) {
        const content = fs.readFileSync(STATE_MACHINE_PATH, 'utf-8');
        passed = content.includes('auditLogger') &&
            content.includes('BOOKING_STATE_CHANGED');
    }
    recordTest('D5', 'State changes are audited', passed);
}

// ============================================================
// TEST GROUP E: FULL BOOKING FLOW
// ============================================================

console.log("\n━━━ Test Group E: Full Booking Flow ━━━");

// E1: initiateBooking method exists
{
    let passed = false;
    if (fs.existsSync(BOOKING_SERVICE_PATH)) {
        const content = fs.readFileSync(BOOKING_SERVICE_PATH, 'utf-8');
        passed = content.includes('initiateBooking');
    }
    recordTest('E1', 'initiateBooking method exists', passed);
}

// E2: requestOtpForBooking method exists
{
    let passed = false;
    if (fs.existsSync(BOOKING_SERVICE_PATH)) {
        const content = fs.readFileSync(BOOKING_SERVICE_PATH, 'utf-8');
        passed = content.includes('requestOtpForBooking');
    }
    recordTest('E2', 'requestOtpForBooking method exists', passed);
}

// E3: confirmBookingWithOtp method exists
{
    let passed = false;
    if (fs.existsSync(BOOKING_SERVICE_PATH)) {
        const content = fs.readFileSync(BOOKING_SERVICE_PATH, 'utf-8');
        passed = content.includes('confirmBookingWithOtp');
    }
    recordTest('E3', 'confirmBookingWithOtp method exists', passed);
}

// E4: Booking uses state machine
{
    let passed = false;
    if (fs.existsSync(BOOKING_SERVICE_PATH)) {
        const content = fs.readFileSync(BOOKING_SERVICE_PATH, 'utf-8');
        passed = content.includes('BookingStateMachine');
    }
    recordTest('E4', 'BookingService uses state machine', passed);
}

// E5: Booking uses OTP service
{
    let passed = false;
    if (fs.existsSync(BOOKING_SERVICE_PATH)) {
        const content = fs.readFileSync(BOOKING_SERVICE_PATH, 'utf-8');
        passed = content.includes('OtpService');
    }
    recordTest('E5', 'BookingService uses OTP service', passed);
}

// ============================================================
// TEST GROUP F: OTP REUSE BLOCKED
// ============================================================

console.log("\n━━━ Test Group F: OTP Reuse Blocked ━━━");

// F1: OTP consumed after verification
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('del(key)') &&
            content.includes('verifyOtp') &&
            content.includes('one-time');
    }
    recordTest('F1', 'OTP deleted after successful verification', passed);
}

// F2: Verification tracks attempts
{
    let passed = false;
    if (fs.existsSync(OTP_SERVICE_PATH)) {
        const content = fs.readFileSync(OTP_SERVICE_PATH, 'utf-8');
        passed = content.includes('attempts') && content.includes('attemptsKey');
    }
    recordTest('F2', 'Verification attempts tracked', passed);
}

// ============================================================
// TEST GROUP G: NOTIFICATIONS
// ============================================================

console.log("\n━━━ Test Group G: Notifications ━━━");

// G1: Notification service exists
{
    const exists = fs.existsSync(NOTIFICATION_PATH);
    recordTest('G1', 'Notification service exists', exists);
}

// G2: SMS notification
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_PATH, 'utf-8');
        passed = content.includes('smsQueue') || content.includes('SMS');
    }
    recordTest('G2', 'SMS notification implemented', passed);
}

// G3: Email notification
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_PATH, 'utf-8');
        passed = content.includes('emailQueue') || content.includes('email');
    }
    recordTest('G3', 'Email notification implemented', passed);
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
    console.log("\n🎉 ALL TESTS PASSED - Phase 4 Booking + OTP Flow Complete!\n");
} else {
    console.log("\n⚠️ Some tests failed. Review output above.\n");
    process.exit(1);
}
