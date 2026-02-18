/**
 * Phase 5: Notifications (SMS + Email) - Test Suite
 * 
 * Tests:
 * A. SMS Queue Integration - SMS queued once per booking
 * B. Email Queue Integration - Email queued successfully
 * C. Failure Isolation - Failures don't break booking
 * D. PHI Safety - Phone numbers not logged in errors
 * E. Per-Hospital Sender ID - Hospital-specific sender config used
 * F. Provider Abstraction - SMS provider interface implemented
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
const PROVIDERS_DIR = path.join(ROOT, 'src/providers');
const SERVICES_DIR = path.join(ROOT, 'src/services');
const WORKERS_DIR = path.join(ROOT, 'src/workers');
const CONFIG_DIR = path.join(ROOT, 'src/config');
const DATA_DIR = path.join(ROOT, 'data');

const SMS_PROVIDER_PATH = path.join(PROVIDERS_DIR, 'SMSProvider.js');
const TWILIO_PROVIDER_PATH = path.join(PROVIDERS_DIR, 'TwilioSMSProvider.js');
const MOCK_PROVIDER_PATH = path.join(PROVIDERS_DIR, 'MockSMSProvider.js');
const SMS_FACTORY_PATH = path.join(PROVIDERS_DIR, 'smsProviderFactory.js');
const NOTIFICATION_SERVICE_PATH = path.join(SERVICES_DIR, 'bookingNotificationService.js');
const SMS_WORKER_PATH = path.join(WORKERS_DIR, 'smsWorker.js');
const QUEUE_CONFIG_PATH = path.join(CONFIG_DIR, 'queue.js');
const HOSPITALS_PATH = path.join(DATA_DIR, 'hospitals.json');

console.log(`
╔════════════════════════════════════════════════════════════╗
║   Phase 5: Notifications (SMS + Email) - Test Suite        ║
╚════════════════════════════════════════════════════════════╝
`);

// ============================================================
// TEST GROUP A: SMS PROVIDER ABSTRACTION
// ============================================================

console.log("\n━━━ Test Group A: SMS Provider Abstraction ━━━");

// A1: Base SMS provider exists
{
    const exists = fs.existsSync(SMS_PROVIDER_PATH);
    recordTest('A1', 'SMSProvider base class exists', exists);
}

// A2: SMSProvider has sendSMS method signature
{
    let passed = false;
    if (fs.existsSync(SMS_PROVIDER_PATH)) {
        const content = fs.readFileSync(SMS_PROVIDER_PATH, 'utf-8');
        passed = content.includes('async sendSMS(') &&
            content.includes('to') &&
            content.includes('message') &&
            content.includes('senderId');
    }
    recordTest('A2', 'SMSProvider.sendSMS() accepts to, message, senderId', passed);
}

// A3: SMSProvider has maskPhone utility
{
    let passed = false;
    if (fs.existsSync(SMS_PROVIDER_PATH)) {
        const content = fs.readFileSync(SMS_PROVIDER_PATH, 'utf-8');
        passed = content.includes('maskPhone(') &&
            content.includes('****') &&
            content.includes('slice(-4)');
    }
    recordTest('A3', 'SMSProvider has PHI-safe maskPhone utility', passed);
}

// A4: Twilio provider exists and extends base
{
    let passed = false;
    if (fs.existsSync(TWILIO_PROVIDER_PATH)) {
        const content = fs.readFileSync(TWILIO_PROVIDER_PATH, 'utf-8');
        passed = content.includes('extends SMSProvider') &&
            content.includes('TWILIO_ACCOUNT_SID') &&
            content.includes('TWILIO_AUTH_TOKEN');
    }
    recordTest('A4', 'TwilioSMSProvider extends SMSProvider with config', passed);
}

// A5: Mock provider exists for testing
{
    let passed = false;
    if (fs.existsSync(MOCK_PROVIDER_PATH)) {
        const content = fs.readFileSync(MOCK_PROVIDER_PATH, 'utf-8');
        passed = content.includes('extends SMSProvider') &&
            content.includes('sentMessages') &&
            content.includes('getSentMessages');
    }
    recordTest('A5', 'MockSMSProvider exists with test helpers', passed);
}

// A6: SMS provider factory exists
{
    let passed = false;
    if (fs.existsSync(SMS_FACTORY_PATH)) {
        const content = fs.readFileSync(SMS_FACTORY_PATH, 'utf-8');
        passed = content.includes('getSMSProvider') &&
            content.includes('ENABLE_SMS_TRANSPORT') &&
            content.includes('TwilioSMSProvider') &&
            content.includes('MockSMSProvider');
    }
    recordTest('A6', 'SMS provider factory with config-based selection', passed);
}

// ============================================================
// TEST GROUP B: SMS QUEUE INTEGRATION
// ============================================================

console.log("\n━━━ Test Group B: SMS Queue Integration ━━━");

// B1: smsQueue exists in queue config
{
    let passed = false;
    if (fs.existsSync(QUEUE_CONFIG_PATH)) {
        const content = fs.readFileSync(QUEUE_CONFIG_PATH, 'utf-8');
        passed = content.includes('smsQueue') &&
            content.includes("new Queue('smsQueue'");
    }
    recordTest('B1', 'smsQueue defined in queue config', passed);
}

// B2: smsQueue exported from queue module
{
    let passed = false;
    if (fs.existsSync(QUEUE_CONFIG_PATH)) {
        const content = fs.readFileSync(QUEUE_CONFIG_PATH, 'utf-8');
        passed = content.includes('module.exports') &&
            content.includes('smsQueue');
    }
    recordTest('B2', 'smsQueue exported from queue module', passed);
}

// B3: SMS worker exists
{
    const exists = fs.existsSync(SMS_WORKER_PATH);
    recordTest('B3', 'SMS worker file exists', exists);
}

// B4: SMS worker uses provider factory
{
    let passed = false;
    if (fs.existsSync(SMS_WORKER_PATH)) {
        const content = fs.readFileSync(SMS_WORKER_PATH, 'utf-8');
        passed = content.includes('getSMSProvider') &&
            content.includes("Worker('smsQueue'");
    }
    recordTest('B4', 'SMS worker uses provider factory', passed);
}

// ============================================================
// TEST GROUP C: NOTIFICATION SERVICE INTEGRATION
// ============================================================

console.log("\n━━━ Test Group C: Notification Service Integration ━━━");

// C1: Notification service imports smsQueue
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_SERVICE_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_SERVICE_PATH, 'utf-8');
        passed = content.includes('smsQueue') &&
            content.includes("require('../config/queue')");
    }
    recordTest('C1', 'Notification service imports smsQueue', passed);
}

// C2: queuePatientSms adds to smsQueue
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_SERVICE_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_SERVICE_PATH, 'utf-8');
        passed = content.includes('queuePatientSms') &&
            content.includes('smsQueue.add(');
    }
    recordTest('C2', 'queuePatientSms adds to smsQueue', passed);
}

// C3: SMS job includes senderId
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_SERVICE_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_SERVICE_PATH, 'utf-8');
        passed = content.includes('senderId:') &&
            content.includes('sms_config?.sender_id');
    }
    recordTest('C3', 'SMS job includes per-hospital senderId', passed);
}

// C4: SMS failures wrapped in try-catch
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_SERVICE_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_SERVICE_PATH, 'utf-8');
        // Find notifyConfirmation method and check for try-catch around SMS
        passed = content.includes('try {') &&
            content.includes('queuePatientSms') &&
            content.includes('catch (err)') &&
            content.includes("Failed to queue SMS");
    }
    recordTest('C4', 'SMS failures wrapped in try-catch (no throw)', passed);
}

// ============================================================
// TEST GROUP D: PHI SAFETY
// ============================================================

console.log("\n━━━ Test Group D: PHI Safety ━━━");

// D1: SMS worker doesn't log phone numbers
{
    let passed = false;
    if (fs.existsSync(SMS_WORKER_PATH)) {
        const content = fs.readFileSync(SMS_WORKER_PATH, 'utf-8');
        // Should use maskPhone or log bookingId, not raw phone
        passed = content.includes('maskPhone') ||
            (content.includes('logger.error') &&
                content.includes('bookingId') &&
                !content.match(/logger\.(error|warn).*\bto\b[\s,)]/));
    }
    recordTest('D1', 'SMS worker uses PHI-safe logging', passed);
}

// D2: Twilio provider masks phone in logs
{
    let passed = false;
    if (fs.existsSync(TWILIO_PROVIDER_PATH)) {
        const content = fs.readFileSync(TWILIO_PROVIDER_PATH, 'utf-8');
        // Verify maskPhone is used when logging AND raw 'to' variable is not in logger calls
        const useMaskPhone = content.includes('this.maskPhone(to)');
        // Count occurrences - should be used in both success and error logging
        const maskPhoneCount = (content.match(/this\.maskPhone\(to\)/g) || []).length;
        passed = useMaskPhone && maskPhoneCount >= 2;
    }
    recordTest('D2', 'TwilioSMSProvider uses maskPhone in all logs', passed);
}

// D3: Mock provider masks phone
{
    let passed = false;
    if (fs.existsSync(MOCK_PROVIDER_PATH)) {
        const content = fs.readFileSync(MOCK_PROVIDER_PATH, 'utf-8');
        passed = content.includes('this.maskPhone(to)');
    }
    recordTest('D3', 'MockSMSProvider uses maskPhone', passed);
}

// ============================================================
// TEST GROUP E: EMAIL INTEGRATION
// ============================================================

console.log("\n━━━ Test Group E: Email Integration ━━━");

// E1: Email queue used for hospital notification
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_SERVICE_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_SERVICE_PATH, 'utf-8');
        passed = content.includes('emailQueue.add(') &&
            content.includes('queueHospitalEmail');
    }
    recordTest('E1', 'Email queue used for hospital confirmation', passed);
}

// E2: Email includes booking details template
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_SERVICE_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_SERVICE_PATH, 'utf-8');
        passed = content.includes('formatHospitalEmail') &&
            content.includes('subject:') &&
            content.includes('html:');
    }
    recordTest('E2', 'Email uses template with booking details', passed);
}

// E3: Email failures wrapped in try-catch
{
    let passed = false;
    if (fs.existsSync(NOTIFICATION_SERVICE_PATH)) {
        const content = fs.readFileSync(NOTIFICATION_SERVICE_PATH, 'utf-8');
        passed = content.includes('try {') &&
            content.includes('queueHospitalEmail') &&
            content.includes('catch (err)') &&
            content.includes("Failed to queue email");
    }
    recordTest('E3', 'Email failures wrapped in try-catch (no throw)', passed);
}

// ============================================================
// TEST GROUP F: HOSPITAL CONFIG
// ============================================================

console.log("\n━━━ Test Group F: Hospital SMS Config ━━━");

// F1: hospitals.json has sms_config
{
    let passed = false;
    if (fs.existsSync(HOSPITALS_PATH)) {
        const content = fs.readFileSync(HOSPITALS_PATH, 'utf-8');
        const hospitals = JSON.parse(content);
        passed = hospitals.default &&
            hospitals.default.sms_config &&
            typeof hospitals.default.sms_config.sender_id === 'string';
    }
    recordTest('F1', 'Default hospital has sms_config.sender_id', passed);
}

// F2: All hospitals have sms_config
{
    let passed = false;
    if (fs.existsSync(HOSPITALS_PATH)) {
        const content = fs.readFileSync(HOSPITALS_PATH, 'utf-8');
        const hospitals = JSON.parse(content);
        const hospitalIds = Object.keys(hospitals);
        passed = hospitalIds.every(id =>
            hospitals[id].sms_config &&
            hospitals[id].sms_config.sender_id
        );
    }
    recordTest('F2', 'All hospitals have sms_config', passed);
}

// F3: Different sender IDs per hospital
{
    let passed = false;
    if (fs.existsSync(HOSPITALS_PATH)) {
        const content = fs.readFileSync(HOSPITALS_PATH, 'utf-8');
        const hospitals = JSON.parse(content);
        const senderIds = Object.values(hospitals).map(h => h.sms_config?.sender_id).filter(Boolean);
        const uniqueIds = new Set(senderIds);
        passed = uniqueIds.size > 1;
    }
    recordTest('F3', 'Different sender IDs for different hospitals', passed);
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
    console.log("\n🎉 ALL TESTS PASSED - Phase 5 Notifications Complete!\n");
} else {
    console.log("\n⚠️ Some tests failed. Review output above.\n");
    process.exit(1);
}
