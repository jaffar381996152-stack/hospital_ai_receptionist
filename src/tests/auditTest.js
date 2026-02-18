const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

const LOG_FILE = path.join(__dirname, '../../logs/audit.log');
const SERVER_PORT = 3001; // Use different port for test
const API_URL = `http://localhost:${SERVER_PORT}/chat`;

console.log("--- Starting Audit Logging Verification ---");

// 0. Cleanup Old Logs
if (fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
    console.log("Cleaned old audit log.");
}

// 1. Start Server (We need the full pipeline running)
const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '../../'),
    env: {
        ...process.env,
        PORT: SERVER_PORT,
        NODE_ENV: 'test',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', // 32 chars hex
        ADMIN_SECRET: 'admin123',
        OPENROUTER_API_KEY: 'test_key'
    },
    stdio: 'inherit' // Pipe output so we see errors
});

// Helper to wait
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function runTests() {
    try {
        console.log("Waiting for server to start...");
        await wait(3000);

        // Client Cookie Jar (Mock Session)
        const cookieJar = {
            cookies: [],
            getCookieString() { return this.cookies.map(c => c.split(';')[0]).join('; '); }
        };

        const postReq = async (message) => {
            const res = await axios.post(API_URL, { message }, {
                headers: { 'Cookie': cookieJar.getCookieString() }
            });
            // Capture cookies
            if (res.headers['set-cookie']) {
                cookieJar.cookies = res.headers['set-cookie'];
            }
            return res.data;
        };

        // --- Interaction 1: First Contact (Disclaimer) ---
        console.log("\nSending: Hello (Expect Disclaimer)");
        await postReq("Hello");
        // Audit: None yet, or just Consent check failed? Consent denied? Actually we don't log "Disclaimer Shown" explicitly in my code, but "MESSAGE_RECEIVED" might be there if it passed redaction?
        // Wait, check server.js order: checkConsent -> phiRedaction -> Audit(Message Received).
        // If Consent blocks, PHI Redaction and Audit(MessReceived) are NOT reached.
        // Consent middleware logs CONSENT_DENIED if user says "No", but first time just shows msg.

        // --- Interaction 2: Consent Denied ---
        console.log("Sending: No (Expect Access Denied Log)");
        await postReq("No");

        // --- Interaction 3: Consent Granted ---
        console.log("Sending: Yes (Expect Consent Granted Log)");
        await postReq("Yes");

        // --- Interaction 4: PHI Redaction Trigger ---
        console.log("Sending: My phone is 0551234567 (Expect Redaction Log)");
        await postReq("My phone is 0551234567");

        // --- Interaction 5: Triage Trigger ---
        console.log("Sending: I have chest pain (Expect Triage Log)");
        // Note: server.js Logic: checkConsent -> phiRedaction -> auditLogger.info('MESSAGE_RECEIVED')
        // So even if triage returns emergency, we logged the REDACTED message.
        await postReq("I have chest pain");

        console.log("\n--- Analyzing Logs ---");
        await wait(1000); // Flush logs

        if (!fs.existsSync(LOG_FILE)) {
            throw new Error("Audit log file not found!");
        }

        const logContent = fs.readFileSync(LOG_FILE, 'utf-8');
        const lines = logContent.trim().split('\n').map(l => {
            try { return JSON.parse(l); } catch (e) { return null; }
        }).filter(l => l);

        console.log(`Found ${lines.length} audit entries.`);

        // Verify Specific Events
        const findLog = (action) => lines.find(l => l.action === action);

        const consentDenied = findLog('CONSENT_DENIED');
        if (consentDenied) console.log("✅ Logged CONSENT_DENIED");
        else console.error("❌ Missing CONSENT_DENIED");

        const consentGranted = findLog('CONSENT_GRANTED');
        if (consentGranted) console.log("✅ Logged CONSENT_GRANTED");
        else console.error("❌ Missing CONSENT_GRANTED");

        const phiRedaction = findLog('PHI_REDACTION');
        if (phiRedaction) {
            console.log("✅ Logged PHI_REDACTION");
            console.log("   Redacted Count:", phiRedaction.data.redacted_count);
        } else console.error("❌ Missing PHI_REDACTION");

        const messageReceived = lines.find(l => l.action === 'MESSAGE_RECEIVED' && l.data.message_redacted.includes('PHONE'));
        if (messageReceived) {
            console.log("✅ Logged MESSAGE_RECEIVED (Redacted)");
            if (!messageReceived.data.message_redacted.includes('055')) {
                console.log("✅ Verified: Phone number is masked in audit log.");
            } else {
                console.error("❌ SECURITY FAIL: Raw phone number found in log!");
            }
        }

        const triageResult = findLog('TRIAGE_RESULT');
        if (triageResult) console.log("✅ Logged TRIAGE_RESULT");
        else console.error("❌ Missing TRIAGE_RESULT");

    } catch (error) {
        console.error("Test Failed:", error.message);
        if (error.response) console.error("API Error:", error.response.data);
    } finally {
        server.kill();
        process.exit();
    }
}

runTests();
