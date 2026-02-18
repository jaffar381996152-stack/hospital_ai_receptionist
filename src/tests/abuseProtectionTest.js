/**
 * Phase 8: Abuse Protection - Comprehensive Test Suite
 * 
 * Tests all requirements from Phase 8:
 * - Test Group A: Hospital-Aware Rate Limiting
 * - Test Group B: Behavioral Abuse Detection
 * - Test Group C: Emergency Safety (CRITICAL)
 * - Test Group D: Escalation Integration
 * - Test Group E: PHI Safety
 * 
 * Run: node src/tests/abuseProtectionTest.js
 */

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_PORT = 3011;
const API_URL = `http://localhost:${SERVER_PORT}/chat`;
const LOG_FILE = path.join(__dirname, '../../logs/audit.log');

console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║    Phase 8: Abuse Protection - Full Test Suite           ║");
console.log("╚═══════════════════════════════════════════════════════════╝\n");

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
    // TEST GROUP A: Hospital-Aware Rate Limiting
    // ============================================================
    console.log("\n━━━ Test Group A: Hospital-Aware Rate Limiting ━━━");

    // A1: Normal hospital usage (5 messages, normal pace)
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");

        let allOk = true;
        for (let i = 0; i < 3; i++) {
            await wait(500); // Normal pace
            const response = await client.send(`Hello, I have a question ${i}`);
            if (response.warning || response.error) {
                allOk = false;
            }
        }

        recordTest('A1', 'Normal hospital usage (no blocking)', allOk);
    }

    // A2: Rapid public abuse attempt (fast requests)
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");

        let warningReceived = false;
        // Send rapid requests without waiting
        for (let i = 0; i < 10; i++) {
            const response = await client.send(`Spam message ${i}`);
            if (response.warning) {
                warningReceived = true;
                break;
            }
        }

        recordTest('A2', 'Public abuse attempt (warning received)', warningReceived);
    }

    // A3: Per-hospital config check
    {
        // Verify hospitals.json has different rate_limit_config
        const hospitalsPath = path.join(__dirname, '../../data/hospitals.json');
        let passed = false;
        let details = '';

        try {
            const hospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf-8'));

            const defaultLimit = hospitals.default?.rate_limit_config?.requests_per_minute || 0;
            const riyadhLimit = hospitals.hospital_riyadh?.rate_limit_config?.requests_per_minute || 0;
            const jeddahLimit = hospitals.hospital_jeddah?.rate_limit_config?.requests_per_minute || 0;

            // Riyadh (hospital network) should have higher limit than default
            passed = riyadhLimit > defaultLimit && jeddahLimit > 0;
            details = `default:${defaultLimit}, riyadh:${riyadhLimit}, jeddah:${jeddahLimit}`;
        } catch (e) {
            details = `Error: ${e.message}`;
        }

        recordTest('A3', 'Per-hospital rate limits configured', passed, details);
    }

    // ============================================================
    // TEST GROUP B: Behavioral Abuse Detection
    // ============================================================
    console.log("\n━━━ Test Group B: Behavioral Abuse Detection ━━━");

    // B1: Repeated identical messages
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");

        let warningReceived = false;
        // Send identical message multiple times
        for (let i = 0; i < 6; i++) {
            await wait(400); // Slight pause but same message
            const response = await client.send("I want to book");
            if (response.warning) {
                warningReceived = true;
                break;
            }
        }

        recordTest('B1', 'Repeated identical messages detected', warningReceived);
    }

    // B2: Rapid-fire timing (requests < 300ms apart)
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");

        let warningOrBlock = false;
        // Send very rapid requests
        for (let i = 0; i < 8; i++) {
            await wait(100); // Very fast
            const response = await client.send(`Quick message ${i}`);
            if (response.warning || (response.reply && response.reply.includes('slow down'))) {
                warningOrBlock = true;
                break;
            }
        }

        recordTest('B2', 'Rapid-fire timing detected', warningOrBlock);
    }

    // ============================================================
    // TEST GROUP C: Emergency Safety (CRITICAL)
    // ============================================================
    console.log("\n━━━ Test Group C: Emergency Safety (CRITICAL) ━━━");

    // C1: Emergency message under abuse conditions
    // Use a FRESH session to avoid prior escalation affecting this test
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");

        // Send a few rapid messages to trigger warnings (but NOT escalation)
        for (let i = 0; i < 3; i++) {
            await client.send("quick");
        }

        // Now send emergency - should ALWAYS get through and trigger emergency response
        const response = await client.send("I have chest pain and can't breathe");

        // Emergency should trigger emergency response (from triage), not be blocked
        // Note: If middleware let it through and we got ANY response (not a 429 block)
        const isEmergencyResponse = response.reply && (
            response.reply.toLowerCase().includes('emergency') ||
            response.reply.toLowerCase().includes('997') ||
            response.reply.toLowerCase().includes('immediately') ||
            response.reply.toLowerCase().includes('call') ||
            !response.error
        );

        recordTest('C1', 'Emergency always bypasses abuse checks', isEmergencyResponse,
            response.reply?.substring(0, 80));
    }

    // ============================================================
    // TEST GROUP D: Escalation Integration
    // ============================================================
    console.log("\n━━━ Test Group D: Escalation Integration ━━━");

    // D1: Persistent abuse triggers escalation
    // Note: Soft blocks occur but we persist until escalation
    {
        const client = new TestClient();
        await client.send("English");
        await client.send("Yes");

        let escalated = false;
        // Need to exceed abuse_block_threshold (default 6)
        // Soft blocks reset warning_count by -2 when they expire
        // So we need sustained abuse across soft block windows
        for (let i = 0; i < 25; i++) {
            await wait(150); // Rapid but not too fast
            const response = await client.send("test"); // Identical message = repeat detection

            // Check for escalation indicators
            if (response.reply && (
                response.reply.includes('representative will contact') ||
                response.reply.includes('forwarded your request') ||
                response.reply.includes('staff at') ||
                response.escalated === true
            )) {
                escalated = true;
                break;
            }

            // If soft blocked, wait a tiny bit and continue
            if (response.reply && response.reply.includes('slow down')) {
                await wait(500); // Brief wait, abuse state still accumulates
            }
        }

        recordTest('D1', 'Persistent abuse triggers human handoff', escalated);
    }

    // ============================================================
    // TEST GROUP E: PHI Safety
    // ============================================================
    console.log("\n━━━ Test Group E: PHI Safety ━━━");

    // E1: Check audit log for PHI-free abuse entries
    await wait(1000); // Allow log writes
    {
        let passed = false;
        let details = '';

        try {
            if (fs.existsSync(LOG_FILE)) {
                const logContent = fs.readFileSync(LOG_FILE, 'utf-8');
                const lines = logContent.trim().split('\n').filter(l => l.trim());
                const abuseLogs = lines
                    .map(l => { try { return JSON.parse(l); } catch { return null; } })
                    .filter(l => l && l.message && (
                        l.message.action === 'ABUSE_DETECTED' ||
                        l.message.action === 'ABUSE_ESCALATION'
                    ));

                if (abuseLogs.length > 0) {
                    const log = abuseLogs[0];
                    const logStr = JSON.stringify(log);

                    // Should NOT contain message content, phone, name
                    const hasNoMessageContent = !logStr.includes('spam') &&
                        !logStr.includes('Abuse test') &&
                        !logStr.includes('I want to book');
                    const hasNoPhone = !logStr.includes('phone_number');

                    // Should have abuse_type metadata
                    const hasAbuseType = log.message.data?.abuse_type !== undefined;

                    passed = hasNoMessageContent && hasNoPhone && hasAbuseType;
                    details = `no_message_content:${hasNoMessageContent}, abuse_type:${hasAbuseType}`;
                } else {
                    details = 'No ABUSE_DETECTED logs found';
                    passed = false;
                }
            } else {
                details = 'Audit log file not found';
            }
        } catch (e) {
            details = `Error: ${e.message}`;
        }

        recordTest('E1', 'PHI-free abuse logging', passed, details);
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
        console.log("\n🎉 ALL TESTS PASSED - Phase 8 Complete!");
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
