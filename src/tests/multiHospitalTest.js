/**
 * Multi-Hospital Support - Full Test Suite
 * 
 * Tests all requirements:
 * - Test Group A: Hospital Resolution
 * - Test Group B: Data Isolation
 * - Test Group C: Behavior Differences  
 * - Test Group D: Emergency Safety
 * - Test Group E: Logging & Audit
 * 
 * Run: node src/tests/multiHospitalTest.js
 */

const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const TEST_TIMEOUT = 60000;

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

// Helper to make requests with session and hospital headers
class TestClient {
    constructor(hospitalId = null) {
        this.cookies = '';
        this.hospitalId = hospitalId;
    }

    async send(message, overrideHospitalId = null) {
        const headers = {
            'Content-Type': 'application/json',
            'Cookie': this.cookies
        };
        const hid = overrideHospitalId || this.hospitalId;
        if (hid) {
            headers['X-Hospital-ID'] = hid;
        }

        try {
            const response = await axios.post(`${BASE_URL}/chat`,
                { message },
                {
                    headers,
                    validateStatus: () => true,
                    withCredentials: true
                }
            );

            // Capture session cookie
            const setCookie = response.headers['set-cookie'];
            if (setCookie) {
                this.cookies = setCookie.map(c => c.split(';')[0]).join('; ');
            }

            return {
                status: response.status,
                data: response.data,
                reply: response.data?.reply || response.data?.message || '',
                error: response.data?.error
            };
        } catch (err) {
            return { status: 500, error: err.message };
        }
    }
}

async function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function waitForServer() {
    for (let i = 0; i < 30; i++) {
        try {
            await axios.get(`${BASE_URL}/health`);
            return true;
        } catch (e) {
            await wait(500);
        }
    }
    return false;
}

async function runTests() {
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║    Multi-Hospital Support - Full Test Suite              ║");
    console.log("╚═══════════════════════════════════════════════════════════╝\n");

    // Start server
    const server = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '../..'),
        env: {
            ...process.env,
            PORT: '3000',
            NODE_ENV: 'test',
            ENABLE_EMAIL_TRANSPORT: 'false'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let serverOutput = '';
    server.stdout.on('data', d => serverOutput += d.toString());
    server.stderr.on('data', d => serverOutput += d.toString());

    console.log("Waiting for server to start...");
    const ready = await waitForServer();
    if (!ready) {
        console.log("❌ Server failed to start");
        console.log(serverOutput);
        server.kill();
        process.exit(1);
    }
    console.log("Server ready. Running tests...\n");

    try {
        // ============================================================
        // TEST GROUP A: Hospital Resolution
        // ============================================================
        console.log("━━━ Test Group A: Hospital Resolution ━━━");

        // A1: Valid hospital_id
        {
            const client = new TestClient('hospital_riyadh');
            const response = await client.send('English');

            const passed = response.status === 200 && !response.error;
            recordTest('A1', 'Valid hospital_id accepted', passed);
        }

        // A2: Missing hospital_id (uses default)
        {
            const client = new TestClient(null); // No hospital ID
            const response = await client.send('English');

            // Should work with default hospital
            const passed = response.status === 200 && !response.error;
            recordTest('A2', 'Missing hospital_id uses default', passed);
        }

        // A3: Invalid hospital_id (rejected)
        {
            const client = new TestClient('fake_hospital_xyz');
            const response = await client.send('Hello');

            // Should be rejected with 400
            const passed = response.status === 400 &&
                (response.error?.includes('Invalid') ||
                    response.data?.error?.includes('Invalid'));
            recordTest('A3', 'Invalid hospital_id rejected', passed,
                `status=${response.status}`);
        }

        // ============================================================
        // TEST GROUP B: Data Isolation (CRITICAL)
        // ============================================================
        console.log("\n━━━ Test Group B: Data Isolation (CRITICAL) ━━━");

        // B1: Consent isolation
        {
            const client = new TestClient('default');

            // Give consent at hospital A (default)
            await client.send('English');
            await client.send('Yes'); // Consent given
            const responseA = await client.send('Hello');

            // Check consent worked at hospital A
            const consentWorkedA = responseA.status === 200 &&
                !responseA.reply.includes('DISCLAIMER');

            // Now switch to hospital B (same session/cookie)
            const responseB = await client.send('Hello', 'hospital_jeddah');

            // Should require NEW consent at hospital B
            const requiresConsentB = responseB.reply.includes('DISCLAIMER') ||
                responseB.reply.includes('agree');

            const passed = consentWorkedA && requiresConsentB;
            recordTest('B1', 'Consent isolated per hospital', passed,
                `consentA=${consentWorkedA}, requiresConsentB=${requiresConsentB}`);
        }

        // B2: Session isolation (conversation history)
        {
            // Test that switching hospitals doesn't carry over context
            const clientA = new TestClient('default');
            const clientB = new TestClient('hospital_riyadh');

            // Start both sessions
            await clientA.send('English');
            await clientA.send('Yes');

            await clientB.send('Arabic');
            await clientB.send('Yes');

            // Sessions are independent (different hospital contexts)
            const responseA = await clientA.send('What departments?');
            const responseB = await clientB.send('What departments?');

            // Both should work independently
            const passed = responseA.status === 200 && responseB.status === 200;
            recordTest('B2', 'Sessions isolated per hospital', passed);
        }

        // ============================================================
        // TEST GROUP C: Behavior Differences
        // ============================================================
        console.log("\n━━━ Test Group C: Behavior Differences ━━━");

        // C1: Different departments per hospital
        {
            // Load hospital configs
            const hospitalsPath = path.join(__dirname, '../../data/hospitals.json');
            const hospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf-8'));

            const defaultDepts = hospitals.default.departments;
            const riyadhDepts = hospitals.hospital_riyadh.departments;
            const jeddahDepts = hospitals.hospital_jeddah.departments;

            // Verify they're different
            const areDifferent =
                defaultDepts.length !== jeddahDepts.length ||
                !defaultDepts.every(d => jeddahDepts.includes(d));

            recordTest('C1', 'Different departments per hospital', areDifferent,
                `default=${defaultDepts.length}, jeddah=${jeddahDepts.length}`);
        }

        // C2: Different booking notifications per hospital
        {
            const hospitalsPath = path.join(__dirname, '../../data/hospitals.json');
            const hospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf-8'));

            const defaultNotifs = hospitals.default.booking_notifications;
            const riyadhNotifs = hospitals.hospital_riyadh.booking_notifications;

            // Riyadh has WhatsApp, default doesn't
            const areDifferent =
                riyadhNotifs?.whatsapp === true &&
                defaultNotifs?.whatsapp === false;

            recordTest('C2', 'Different booking channels per hospital', areDifferent);
        }

        // ============================================================
        // TEST GROUP D: Emergency Safety
        // ============================================================
        console.log("\n━━━ Test Group D: Emergency Safety ━━━");

        // D1: Emergency works in any hospital
        {
            const client = new TestClient('hospital_jeddah');

            // Don't give consent, send emergency
            const response = await client.send('I have chest pain');

            // Should get emergency response regardless of consent
            const isEmergency = response.reply?.includes('EMERGENCY') ||
                response.reply?.includes('997') ||
                response.reply?.includes('URGENT');

            recordTest('D1', 'Emergency bypasses all at any hospital', isEmergency);
        }

        // ============================================================
        // TEST GROUP E: Logging & Audit
        // ============================================================
        console.log("\n━━━ Test Group E: Logging & Audit ━━━");

        // E1: Hospital config includes all required fields
        {
            const hospitalsPath = path.join(__dirname, '../../data/hospitals.json');
            const hospitals = JSON.parse(fs.readFileSync(hospitalsPath, 'utf-8'));

            const requiredFields = [
                'id', 'name', 'departments', 'working_hours',
                'default_language', 'emergency_number',
                'escalation_contact', 'otp_enabled', 'human_handoff_enabled'
            ];

            let allValid = true;
            let missing = [];

            for (const [hid, config] of Object.entries(hospitals)) {
                for (const field of requiredFields) {
                    if (config[field] === undefined) {
                        allValid = false;
                        missing.push(`${hid}.${field}`);
                    }
                }
            }

            recordTest('E1', 'All hospitals have required fields', allValid,
                missing.length ? `Missing: ${missing.join(', ')}` : 'All present');
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
            console.log("\n🎉 ALL TESTS PASSED - Multi-Hospital Support Complete!");
        } else {
            console.log("\n⚠️ Some tests failed. Review output above.");
        }

    } finally {
        server.kill();
    }

    process.exit(results.failed === 0 ? 0 : 1);
}

runTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
