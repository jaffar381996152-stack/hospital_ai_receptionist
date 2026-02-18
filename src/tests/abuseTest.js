const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PORT = 3010;
const API_URL = `http://localhost:${SERVER_PORT}/chat`;

console.log("--- Phase 8: Abuse Protection Verification ---");

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
    // console.log(d.toString());
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
            return { status: res.status, data: res.data };
        } catch (err) {
            return {
                status: err.response ? err.response.status : 500,
                data: err.response ? err.response.data : { error: err.message }
            };
        }
    };

    // 0. Initialize Session
    await send("English"); // Set language
    await send("Yes"); // Consent

    // 1. Send 5 messages rapidly (Should pass)
    console.log("Firing 5 messages...");
    for (let i = 1; i <= 5; i++) {
        const res = await send(`Message ${i}`);
        if (res.status !== 200) {
            console.error(`❌ Message ${i} failed unexpectedly:`, res.data);
            process.exit(1);
        }
    }
    console.log("✅ 5 messages accepted.");

    // 2. Send 6th message (Should Block)
    console.log("Firing 6th message (Should Block)...");
    const resBlocked = await send("Message 6");

    if (resBlocked.status === 429 && resBlocked.data.error.includes("too quickly")) {
        console.log("✅ 6th message correctly blocked (429).");
        console.log("Error:", resBlocked.data.error);
    } else {
        console.error("❌ 6th message NOT blocked. Status:", resBlocked.status, resBlocked.data);
        process.exit(1);
    }

    server.kill();
    process.exit(0);
}

runTests();
