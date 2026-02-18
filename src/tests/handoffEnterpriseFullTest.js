/**
 * Phase 7: Enterprise Human Handoff - Comprehensive Test Suite
 * 
 * Tests all requirements from Phase 7:
 * - Test Group A: User-Initiated Handoff (English + Arabic)
 * - Test Group B: Automatic Escalation Triggers
 * - Test Group C: AI Disengagement (CRITICAL)
 * - Test Group D: PHI Safety
 * - Test Group E: Per-Hospital Behavior
 * - Test Group F: Audit Logging
 * 
 * Run: node src/tests/handoffEnterpriseFullTest.js
 */

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_PORT = 3010;
const API_URL = `http://localhost:${SERVER_PORT}/chat`;
const LOG_FILE = path.join(__dirname, '../../logs/audit.log');

console.log("╔═════════════════════════════════════════════════════════════╗");
console.log("║    Phase 7: Enterprise Human Handoff - Full Test Suite     ║");
console.log("╚═════════════════════════════════════════════════════════════╝\n");

// Clear audit log for clean test
if (fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
}

const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '../../'),
    env: {
        ...process.env,
        PORT: SERVER_PORT,
        NODE_ENV: 'test',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        ADMIN_SECRET: 'admin123',
        OPENROUTER_API_KEY: 'test_key',
        ENABLE_EMAIL_TRANSPORT: 'true'
    },
    stdio: 'pipe'
});

let serverReady = false;
server.stdout.on('data', d => {
    const msg = d.toString();
    if (msg.includes('Production Server running')) serverReady = true;
});
server.stderr.on('data', d => {
    // Uncomment to debug: console.error(d.toString());
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Test results tracker
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

function recordTest(group, name, passed, details = '') {
    results.tests.push({ group, name, passed, details });
    if (passed) {
        results.passed++;
        console.log(`✅ ${group} - ${name}`);
    } else {
        results.failed++;
        console.log(`❌ ${group} - ${name}`);
        if (details) console.log(`   Details: ${details}`);
    }
}

async function runTests() {
    console.log("Waiting for server to start...");
    let attempts = 0;
    while (!serverReady && attempts < 20) {
        await wait(500);
        attempts++;
    }
    if (!serverReady) {
        console.error("❌ Server failed to start");
        server.kill();
        process.exit(1);
    }
    console.log("Server ready. Running tests...\n");

    // ============================================================
    // TEST GROUP A: User-Initiated Handoff
    // ============================================================
    console.log("\n━━━ Test Group A: User-Initiated Handoff ━━━");

    // A1: English handoff request
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");
        const response = await client.send("I want to talk to a human");

        const hasForwarded = response.reply && response.reply.includes("representative will contact");
        recordTest('A1', 'English handoff request', hasForwarded, response.reply?.substring(0, 100));
    }

    // A2: Arabic handoff request
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");
        const response = await client.send("أريد التحدث مع شخص حقيقي");

        const hasForwarded = response.reply && response.reply.includes("representative will contact");
        recordTest('A2', 'Arabic handoff request', hasForwarded, response.reply?.substring(0, 100));
    }

    // ============================================================
    // TEST GROUP B: Automatic Escalation
    // ============================================================
    console.log("\n━━━ Test Group B: Automatic Escalation ━━━");

    // B1: Repeated failures (simulate 3 failures via FORCE_FAIL)
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");

        // Force 3 failures (threshold is 2, so 3rd should trigger)
        await client.send("FORCE_FAIL");
        await client.send("FORCE_FAIL");
        const response = await client.send("FORCE_FAIL");

        const hasEscalated = response.reply && response.reply.includes("representative will contact");
        recordTest('B1', 'Repeated failure auto-escalation', hasEscalated, response.reply?.substring(0, 100));
    }

    // ============================================================
    // TEST GROUP C: AI Disengagement (CRITICAL)
    // ============================================================
    console.log("\n━━━ Test Group C: AI Disengagement (CRITICAL) ━━━");

    // C1: Post-escalation input gets static response
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");

        // First trigger handoff
        await client.send("I need a human agent");

        // Now send another message - should get static response, AI NOT called
        const response = await client.send("Are you still there?");

        const hasStaticResponse = response.reply === "A hospital representative will contact you shortly.";
        recordTest('C1', 'Post-escalation static response (AI disengaged)', hasStaticResponse, response.reply);
    }

    // ============================================================
    // TEST GROUP D: PHI Safety
    // ============================================================
    console.log("\n━━━ Test Group D: PHI Safety ━━━");

    // D1: Check audit log for PHI-safe payload
    await wait(1000); // Allow log writes to complete
    {
        let passed = false;
        let details = '';

        try {
            if (fs.existsSync(LOG_FILE)) {
                const logContent = fs.readFileSync(LOG_FILE, 'utf-8');
                const lines = logContent.trim().split('\n').filter(l => l.trim());
                const handoffLogs = lines
                    .map(l => { try { return JSON.parse(l); } catch { return null; } })
                    .filter(l => l && l.message && l.message.action === 'HUMAN_HANDOFF');

                if (handoffLogs.length > 0) {
                    const log = handoffLogs[0];
                    const msg = log.message; // Winston nests data in message

                    // Check what's IN the log (should have these)
                    const hasHospitalId = msg.hospital_id !== undefined;
                    const hasConversationId = msg.conversationId !== undefined;
                    const hasTriggerType = msg.data?.trigger_type !== undefined;

                    // Check what's NOT in the log (PHI - should NOT have these)
                    const logStr = JSON.stringify(log);
                    const hasNoPhone = !logStr.includes('phone_number');
                    const hasNoMessage = !msg.data?.message && !msg.data?.user_message;

                    passed = hasHospitalId && hasConversationId && hasTriggerType && hasNoMessage;
                    details = `hospital_id:${hasHospitalId}, conversationId:${hasConversationId}, trigger_type:${hasTriggerType}, no_message_content:${hasNoMessage}`;
                } else {
                    details = 'No HUMAN_HANDOFF logs found';
                }
            } else {
                details = 'Audit log file not found';
            }
        } catch (e) {
            details = `Error parsing logs: ${e.message}`;
        }

        recordTest('D1', 'PHI-safe payload (no message content in log)', passed, details);
    }

    // ============================================================
    // TEST GROUP E: Per-Hospital Behavior
    // ============================================================
    console.log("\n━━━ Test Group E: Per-Hospital Behavior ━━━");

    // E1: Default hospital uses email channel (check log for routing)
    {
        // This is verified by the structure - we check hospitals.json config
        const hospitalsPath = path.join(__dirname, '../../data/hospitals.json');
        let passed = false;
        let details = '';

        try {
            const hospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf-8'));

            const defaultHasEmail = hospitals.default?.escalation_config?.channel === 'email';
            const riyadhHasWhatsapp = hospitals.hospital_riyadh?.escalation_config?.channel === 'whatsapp_webhook';
            const jeddahHasEmail = hospitals.hospital_jeddah?.escalation_config?.channel === 'email';

            passed = defaultHasEmail && riyadhHasWhatsapp && jeddahHasEmail;
            details = `default:${hospitals.default?.escalation_config?.channel}, riyadh:${hospitals.hospital_riyadh?.escalation_config?.channel}, jeddah:${hospitals.hospital_jeddah?.escalation_config?.channel}`;
        } catch (e) {
            details = `Error: ${e.message}`;
        }

        recordTest('E1', 'Per-hospital escalation channels configured', passed, details);
    }

    // ============================================================
    // TEST GROUP F: Audit Logging
    // ============================================================
    console.log("\n━━━ Test Group F: Audit Logging ━━━");

    // F1: Audit entry has required fields
    {
        let passed = false;
        let details = '';

        try {
            if (fs.existsSync(LOG_FILE)) {
                const logContent = fs.readFileSync(LOG_FILE, 'utf-8');
                const lines = logContent.trim().split('\n').filter(l => l.trim());
                const handoffLogs = lines
                    .map(l => { try { return JSON.parse(l); } catch { return null; } })
                    .filter(l => l && l.message && l.message.action === 'HUMAN_HANDOFF');

                if (handoffLogs.length > 0) {
                    const log = handoffLogs[0];
                    const msg = log.message; // Winston nests data in message

                    const hasAction = msg.action === 'HUMAN_HANDOFF';
                    const hasHospitalId = msg.hospital_id !== undefined;
                    const hasTriggerType = msg.data?.trigger_type !== undefined;
                    const hasTimestamp = log.timestamp !== undefined;

                    passed = hasAction && hasHospitalId && hasTriggerType && hasTimestamp;
                    details = `action:${hasAction}, hospital_id:${hasHospitalId}, trigger_type:${hasTriggerType}, timestamp:${hasTimestamp}`;
                } else {
                    details = 'No HUMAN_HANDOFF logs found';
                }
            } else {
                details = 'Audit log file not found';
            }
        } catch (e) {
            details = `Error: ${e.message}`;
        }

        recordTest('F1', 'Audit log contains required fields', passed, details);
    }

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log("\n╔═════════════════════════════════════════╗");
    console.log("║             TEST SUMMARY                ║");
    console.log("╚═════════════════════════════════════════╝");
    console.log(`Total: ${results.passed + results.failed}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);

    if (results.failed === 0) {
        console.log("\n🎉 ALL TESTS PASSED - Phase 7 Complete!");
    } else {
        console.log("\n⚠️ Some tests failed. Review output above.");
    }

    server.kill();
    process.exit(results.failed === 0 ? 0 : 1);
}

/**
 * Test client with session persistence
 */
class TestClient {
    constructor() {
        this.cookies = [];
    }

    async send(message) {
        const headers = {};
        if (this.cookies.length) {
            headers['Cookie'] = this.cookies.map(c => c.split(';')[0]).join('; ');
        }

        try {
            const res = await axios.post(API_URL, { message }, { headers });

            if (res.headers['set-cookie']) {
                res.headers['set-cookie'].forEach(c => {
                    if (!this.cookies.includes(c)) this.cookies.push(c);
                });
            }

            return res.data;
        } catch (err) {
            return err.response ? err.response.data : { error: err.message };
        }
    }
}

runTests();
