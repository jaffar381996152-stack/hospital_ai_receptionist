const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PORT = 3008; // New port
const API_URL = `http://localhost:${SERVER_PORT}/chat`;

console.log("--- Phase 2.5: Language Verification ---");

// Start Server
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

    // Helper for session cookies
    const createSession = () => ({
        cookies: [],
        getCookieString() { return this.cookies.map(c => c.split(';')[0]).join('; '); },
        async send(msg) {
            const headers = {};
            const cookieStr = this.getCookieString();
            if (cookieStr) headers['Cookie'] = cookieStr;
            try {
                const res = await axios.post(API_URL, { message: msg }, { headers });
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
    });

    let passed = true;

    // Test 1: New Session -> Asks for Language
    const s1 = createSession();
    const r1 = await s1.send("Hello");
    if (r1.reply && (r1.reply.includes("Select your preferred language") || r1.reply.includes("الرجاء اختيار اللغة"))) {
        console.log("✅ Test 1 Passed: Language prompt shown.");
    } else {
        console.error("❌ Test 1 Failed: Expected language prompt. Got:", r1);
        passed = false;
    }

    // Test 2: Select Arabic -> Disclaimer in Arabic
    const r2 = await s1.send("Arabic");
    // Should get "تنبيه هام" (Disclaimer in AR) or Confirmation then Disclaimer.
    // Logic says: if matched, next() -> Consent Middleware -> Disclaimer
    if (r2.reply && r2.reply.includes("تنبيه هام")) {
        console.log("✅ Test 2 Passed: Arabic selected, Arabic Disclaimer shown.");
    } else {
        console.error("❌ Test 2 Failed: Expected Arabic Disclaimer. Got:", r2);
        passed = false;
    }

    // Test 3: Select English (New Session)
    const s2 = createSession();
    await s2.send("Hi"); // Trigger prompt
    const r3 = await s2.send("English");
    if (r3.reply && r3.reply.includes("IMPORTANT DISCLAIMER")) {
        console.log("✅ Test 3 Passed: English selected, English Disclaimer shown.");
    } else {
        console.error("❌ Test 3 Failed: Expected English Disclaimer. Got:", r3);
        passed = false;
    }

    // Test 4: Roman Arabic (New Session)
    const s3 = createSession();
    await s3.send("Salam");
    const r4 = await s3.send("Arabizi");
    if (r4.reply && (r4.reply.includes("Tanbih Ham") || r4.reply.includes("Hatha al-musa3ed"))) {
        console.log("✅ Test 4 Passed: Arabizi selected, Roman Arabic Disclaimer shown.");
    } else {
        console.error("❌ Test 4 Failed: Expected Roman Arabic Disclaimer. Got:", r4);
        passed = false;
    }

    server.kill();
    process.exit(passed ? 0 : 1);
}

runTests();
