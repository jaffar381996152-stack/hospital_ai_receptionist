const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PORT = 3009;
const API_URL = `http://localhost:${SERVER_PORT}/chat`;

console.log("--- Phase 7: Enterprise Handoff Verification ---");

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
    if (d.toString().includes('Production Server running')) serverReady = true;
});
// server.stderr.on('data', d => console.error(d.toString()));

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
    console.log("Waiting for server...");
    while (!serverReady) await wait(500);
    console.log("Server ready.");

    const headers = {};
    let cookies = [];

    const send = async (msg) => {
        if (cookies.length) headers['Cookie'] = cookies.map(c => c.split(';')[0]).join('; ');
        try {
            const res = await axios.post(API_URL, { message: msg }, { headers });
            if (res.headers['set-cookie']) {
                res.headers['set-cookie'].forEach(c => {
                    if (!cookies.includes(c)) cookies.push(c);
                });
            }
            return res.data;
        } catch (err) {
            return err.response ? err.response.data : { error: err.message };
        }
    };

    // 0. Set Language & Consent
    await send("English");
    await send("Yes"); // Agree to disclaimer

    let passed = true;

    // 1. Force Fail 1
    console.log("Sending Fail 1...");
    const r1 = await send("FORCE_FAIL");
    if (r1.reply === "Simulated Failure") {
        console.log("✅ Fail 1 recorded.");
    } else {
        console.error("❌ Fail 1 verification failed:", r1);
        passed = false;
    }

    // 2. Force Fail 2
    console.log("Sending Fail 2...");
    const r2 = await send("FORCE_FAIL");
    if (r2.reply === "Simulated Failure") {
        console.log("✅ Fail 2 recorded.");
    } else {
        console.error("❌ Fail 2 verification failed");
        passed = false;
    }

    // 3. Force Fail 3 -> SHOULD TRIGGER HANDOFF
    console.log("Sending Fail 3 (Trigger)...");
    const r3 = await send("FORCE_FAIL");

    // Check for dynamic contact info from hospital-info.json (+966 11 234 5678)
    if (r3.reply.includes("forwarded your request") && r3.reply.includes("966 11 234 5678")) {
        console.log("✅ Auto-Handoff Triggered Successfully with correct contact info.");
    } else {
        console.error("❌ Auto-Handoff Failed. Got:", r3);
        passed = false;
    }

    server.kill();
    process.exit(passed ? 0 : 1);
}

runTests();
