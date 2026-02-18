const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

const LOG_FILE = path.join(__dirname, '../../logs/audit.log');
const SERVER_PORT = 3002; // Use distinct port
const API_URL = `http://localhost:${SERVER_PORT}/chat`;

console.log("--- Starting Human Handoff Verification ---");

if (fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
}

const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '../../'),
    env: { ...process.env, PORT: SERVER_PORT, NODE_ENV: 'test' },
    stdio: 'inherit'
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
    try {
        console.log("Waiting for server...");
        await wait(3000);

        const cookieJar = {
            cookies: [],
            getCookieString() { return this.cookies.map(c => c.split(';')[0]).join('; '); }
        };

        const postReq = async (message) => {
            const res = await axios.post(API_URL, { message }, {
                headers: { 'Cookie': cookieJar.getCookieString() }
            });
            if (res.headers['set-cookie']) {
                cookieJar.cookies = res.headers['set-cookie'];
            }
            return res.data;
        };

        // 1. Consent (Yes)
        await postReq("Yes");

        // 2. Request Handoff
        console.log("Sending: 'I need a human agent'...");
        const response = await postReq("I need a human agent");
        console.log("Response:", response.reply);

        if (response.reply.includes("forwarded your request")) {
            console.log("✅ Handoff Response Verified");
        } else {
            console.error("❌ Handoff Response Failed");
        }

        // 3. Verify Log
        await wait(3000);
        const logContent = fs.readFileSync(LOG_FILE, 'utf-8');
        const lines = logContent.trim().split('\n').map(l => JSON.parse(l));
        console.log("DEBUG: Found logs:", lines);

        const handoffEvent = lines.find(l => l.action === 'HUMAN_HANDOFF');
        if (handoffEvent) {
            console.log("✅ Audit Logged HUMAN_HANDOFF");
            console.log("   Reason:", handoffEvent.data.reason);
        } else {
            console.error("❌ Audit Log Missing HUMAN_HANDOFF");
        }

    } catch (error) {
        console.error("Test Failed:", error.message);
    } finally {
        server.kill();
        process.exit();
    }
}

runTests();
