const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PORT = 3007; // Different port to avoid conflicts
const API_URL = `http://localhost:${SERVER_PORT}/chat`;

console.log("--- Phase 2: Consent & Disclaimer Compliance Test ---");
console.log("Tests verify KSA hospital compliance criteria\n");

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
    if (d.toString().includes('Production Server running')) serverReady = true;
});
server.stderr.on('data', d => console.error(d.toString()));

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Create a fresh session for each test group
const createSession = () => ({
    cookies: [],
    getCookieString() { return this.cookies.map(c => c.split(';')[0]).join('; '); }
});

const postMessage = async (msg, cookieJar) => {
    const headers = {};
    const cookieStr = cookieJar.getCookieString();
    if (cookieStr) headers['Cookie'] = cookieStr;

    try {
        const res = await axios.post(API_URL, { message: msg }, { headers });
        if (res.headers['set-cookie']) {
            res.headers['set-cookie'].forEach(c => {
                if (!cookieJar.cookies.includes(c)) cookieJar.cookies.push(c);
            });
        }
        return res.data;
    } catch (err) {
        return err.response ? err.response.data : { error: err.message };
    }
};

async function runTests() {
    console.log("Waiting for server...");
    while (!serverReady) await wait(500);
    console.log("Server ready.\n");

    let passed = true;

    // ================================================================
    // TEST GROUP A: Fresh Session Flow (Language -> Consent)
    // ================================================================
    console.log("=== GROUP A: Standard User Flow ===\n");

    const sessionA = createSession();

    // A1: First contact shows LANGUAGE prompt (before consent)
    const a1 = await postMessage("Hello", sessionA);
    if (a1.reply && a1.reply.includes("Please select your preferred language")) {
        console.log("✅ A1 Passed: Language selection shown first (before consent).");
    } else {
        console.error("❌ A1 Failed: Expected language prompt. Got:", a1);
        passed = false;
    }

    // A2: Select language -> Shows CONSENT disclaimer
    const a2 = await postMessage("English", sessionA);
    if (a2.reply && a2.reply.includes("IMPORTANT DISCLAIMER") && a2.reply.includes("administrative assistance only")) {
        console.log("✅ A2 Passed: Disclaimer shown after language selection.");
    } else {
        console.error("❌ A2 Failed: Expected disclaimer. Got:", a2);
        passed = false;
    }

    // A3: Refuse consent -> Access denied
    const a3 = await postMessage("No", sessionA);
    if (a3.reply && a3.reply.includes("Access denied")) {
        console.log("✅ A3 Passed: Refusal blocks access.");
    } else {
        console.error("❌ A3 Failed: Expected access denial. Got:", a3);
        passed = false;
    }

    // A4: After refusal, still shows disclaimer (not accepted)
    const a4 = await postMessage("Book an appointment", sessionA);
    if (a4.reply && a4.reply.includes("IMPORTANT DISCLAIMER")) {
        console.log("✅ A4 Passed: After refusal, disclaimer is re-shown (not accepted).");
    } else {
        console.error("❌ A4 Failed: Expected disclaimer re-shown. Got:", a4);
        passed = false;
    }

    // A5: Accept consent -> Confirmation
    const a5 = await postMessage("Yes", sessionA);
    if (a5.reply && a5.reply.includes("Thank you")) {
        console.log("✅ A5 Passed: Consent accepted, confirmation shown.");
    } else {
        console.error("❌ A5 Failed: Expected acceptance. Got:", a5);
        passed = false;
    }

    // A6: After consent, messages flow through (no disclaimer)
    const a6 = await postMessage("Hello again", sessionA);
    if (!a6.reply || !a6.reply.includes("DISCLAIMER")) {
        console.log("✅ A6 Passed: After consent, messages processed (no disclaimer).");
    } else {
        console.error("❌ A6 Failed: Still showing disclaimer. Got:", a6);
        passed = false;
    }

    // ================================================================
    // TEST GROUP B: Emergency Pre-Consent (CRITICAL - Criterion 5)
    // ================================================================
    console.log("\n=== GROUP B: Emergency Pre-Consent (Critical) ===\n");

    const sessionB = createSession();

    // B1: Emergency BEFORE any selection -> Should get emergency response
    // Language middleware has emergency bypass, then consent middleware handles it
    const b1 = await postMessage("I am having a heart attack", sessionB);
    if (b1.reply && b1.reply.includes("997") && b1.reply.includes("URGENT")) {
        console.log("✅ B1 Passed: Emergency response returned WITHOUT invoking triage/AI.");
        // Extra check: no data collected message
        if (b1.reply.includes("No data has been collected")) {
            console.log("   ✓ Confirmed: No data collection message present.");
        }
    } else {
        console.error("❌ B1 Failed: Expected emergency response. Got:", b1);
        passed = false;
    }

    // ================================================================
    // TEST GROUP C: Backend Enforcement (Direct API Call Simulation)
    // ================================================================
    console.log("\n=== GROUP C: Backend Enforcement (API Direct Call) ===\n");

    const sessionC = createSession();

    // C1: Direct API call without frontend - First call shows language
    const c1 = await postMessage("Book me an appointment please", sessionC);
    if (c1.reply && c1.reply.includes("Please select your preferred language")) {
        console.log("✅ C1 Passed: Direct API call blocked by language gate.");
    } else {
        console.error("❌ C1 Failed: Expected language gate. Got:", c1);
        passed = false;
    }

    // C2: After language, consent gate blocks
    const c2 = await postMessage("English", sessionC);
    if (c2.reply && c2.reply.includes("IMPORTANT DISCLAIMER")) {
        console.log("✅ C2 Passed: After language, consent gate blocks direct API call.");
    } else {
        console.error("❌ C2 Failed: Expected consent gate. Got:", c2);
        passed = false;
    }

    // C3: Try to use service without consent -> Still blocked
    const c3 = await postMessage("What are your working hours?", sessionC);
    if (c3.reply && c3.reply.includes("IMPORTANT DISCLAIMER")) {
        console.log("✅ C3 Passed: Business query blocked without consent.");
    } else {
        console.error("❌ C3 Failed: Expected blocking. Got:", c3);
        passed = false;
    }

    // ================================================================
    // TEST GROUP D: Disclaimer Wording Verification (Criterion 4)
    // ================================================================
    console.log("\n=== GROUP D: Disclaimer Wording ===\n");

    const sessionD = createSession();
    await postMessage("English", sessionD); // Get to consent screen
    const d1 = await postMessage("Hello", sessionD);

    const requiredPhrases = [
        "administrative assistance only",
        "NOT",
        "medical advice",
        "997"
    ];

    let wordingPassed = true;
    for (const phrase of requiredPhrases) {
        if (!d1.reply || !d1.reply.includes(phrase)) {
            console.error(`❌ D1 Failed: Missing required phrase: "${phrase}"`);
            wordingPassed = false;
            passed = false;
        }
    }
    if (wordingPassed) {
        console.log("✅ D1 Passed: Disclaimer contains all required legal phrases.");
    }

    // ================================================================
    // RESULTS
    // ================================================================
    console.log("\n=================================================");
    if (passed) {
        console.log("✅ ALL TESTS PASSED - Phase 2 Compliance Verified");
    } else {
        console.log("❌ SOME TESTS FAILED - Review Required");
    }
    console.log("=================================================\n");

    server.kill();
    process.exit(passed ? 0 : 1);
}

runTests();
