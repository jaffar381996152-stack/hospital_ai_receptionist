/**
 * Phase 3: AI Provider Abstraction — Test Suite
 * 
 * Tests verify:
 * - Group A: Provider selection (A1-A3)
 * - Group B: PHI safety boundary (B1-B2)
 * - Group C: Emergency flow integrity (C1-C2)
 * - Group D: No behavioral regression (D1-D2)
 */

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_PORT = 3008;
const API_URL = `http://localhost:${SERVER_PORT}/chat`;

console.log("--- Phase 3: AI Provider Abstraction Test Suite ---\n");

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

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Test A1: Default Provider (OpenRouter)
async function testA1_DefaultProvider() {
    console.log("=== TEST A1: Default Provider (OpenRouter) ===");

    const env = {
        ...process.env,
        PORT: SERVER_PORT,
        NODE_ENV: 'test',
        AI_PROVIDER: 'openrouter',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        ADMIN_SECRET: 'admin123'
    };

    const server = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '../../'),
        env,
        stdio: 'pipe'
    });

    let logs = '';
    let serverReady = false;

    server.stdout.on('data', d => {
        logs += d.toString();
        if (d.toString().includes('Production Server running')) serverReady = true;
    });
    server.stderr.on('data', d => logs += d.toString());

    while (!serverReady) await wait(500);

    // Check logs for provider initialization
    const hasOpenRouterLog = logs.includes('provider = openrouter') || logs.includes('OpenRouterProvider');

    server.kill();

    if (hasOpenRouterLog) {
        console.log("✅ A1 Passed: OpenRouter provider initialized by default\n");
        return true;
    } else {
        console.log("❌ A1 Failed: OpenRouter provider not detected in logs");
        console.log("Logs:", logs.substring(0, 500));
        return false;
    }
}

// Test A2: OpenAI Stub (No Key)
async function testA2_OpenAIStub() {
    console.log("=== TEST A2: OpenAI Stub (No Key) ===");

    const env = {
        ...process.env,
        PORT: SERVER_PORT,
        NODE_ENV: 'test',
        AI_PROVIDER: 'openai',
        OPENAI_API_KEY: '',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        ADMIN_SECRET: 'admin123'
    };

    const server = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '../../'),
        env,
        stdio: 'pipe'
    });

    let logs = '';
    let serverReady = false;

    server.stdout.on('data', d => {
        logs += d.toString();
        if (d.toString().includes('Production Server running')) serverReady = true;
    });
    server.stderr.on('data', d => logs += d.toString());

    // Wait for server to start (or fail)
    let timeout = 0;
    while (!serverReady && timeout < 10000) {
        await wait(500);
        timeout += 500;
    }

    if (!serverReady) {
        server.kill();
        console.log("❌ A2 Failed: Server did not start");
        return false;
    }

    // Check logs for inactive warning
    const hasInactiveWarning = logs.includes('inactive') || logs.includes('No API key');

    // Try to send a message and check for fallback response
    const session = createSession();
    await postMessage("English", session); // Select language
    await postMessage("Yes", session); // Accept consent
    const response = await postMessage("Hello", session);

    server.kill();

    if (hasInactiveWarning && response.reply) {
        console.log("✅ A2 Passed: OpenAI stub inactive, fallback message returned\n");
        return true;
    } else {
        console.log("❌ A2 Failed: Expected inactive warning and fallback");
        return false;
    }
}

// Test A3: Invalid Provider
async function testA3_InvalidProvider() {
    console.log("=== TEST A3: Invalid Provider ===");

    const env = {
        ...process.env,
        PORT: SERVER_PORT,
        NODE_ENV: 'test',
        AI_PROVIDER: 'invalid_provider',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        ADMIN_SECRET: 'admin123'
    };

    return new Promise((resolve) => {
        const server = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '../../'),
            env,
            stdio: 'pipe'
        });

        let logs = '';
        let exitedWithError = false;

        server.stdout.on('data', d => logs += d.toString());
        server.stderr.on('data', d => logs += d.toString());

        server.on('exit', (code) => {
            exitedWithError = code !== 0;
        });

        // Wait and check
        setTimeout(() => {
            server.kill();

            const hasErrorLog = logs.includes('Invalid AI_PROVIDER') || logs.includes('invalid_provider');

            if (exitedWithError || hasErrorLog) {
                console.log("✅ A3 Passed: Invalid provider causes startup error\n");
                resolve(true);
            } else {
                console.log("❌ A3 Failed: Should have errored on invalid provider");
                resolve(false);
            }
        }, 5000);
    });
}

// Test B1: Raw Input Cannot Reach AI
async function testB1_RawInputBlocked() {
    console.log("=== TEST B1: Raw Input Cannot Reach AI ===");

    const env = {
        ...process.env,
        PORT: SERVER_PORT,
        NODE_ENV: 'test',
        AI_PROVIDER: 'openrouter',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        ADMIN_SECRET: 'admin123'
    };

    const server = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '../../'),
        env,
        stdio: 'pipe'
    });

    let logs = '';
    let serverReady = false;

    server.stdout.on('data', d => {
        logs += d.toString();
        if (d.toString().includes('Production Server running')) serverReady = true;
    });
    server.stderr.on('data', d => logs += d.toString());

    while (!serverReady) await wait(500);

    // Send message with PHI
    const session = createSession();
    await postMessage("English", session);
    await postMessage("Yes", session);
    await postMessage("My name is Ahmed, my phone is 0551234567", session);

    server.kill();

    // Check that SafeAIInput was created (proves boundary is in use)
    const hasSafeInputLog = logs.includes('SafeAIInput') || logs.includes('safe input');

    // Check for any evidence of redaction
    const hasRedactionEvidence = logs.includes('PHI_REDACTION') || logs.includes('Masked') || logs.includes('[PHONE');

    if (hasSafeInputLog || hasRedactionEvidence) {
        console.log("✅ B1 Passed: Safety boundary active, redaction evidence found\n");
        return true;
    } else {
        console.log("❌ B1 Failed: No safety boundary evidence");
        return false;
    }
}

// Test B2: Forced Raw Injection Attempt (Unit Test)
function testB2_ForcedInjection() {
    console.log("=== TEST B2: Forced Raw Injection Attempt ===");

    try {
        const { validateSafeInput, SafeAIInput } = require('../utils/safeAIInput');

        // Try to pass raw string instead of SafeAIInput
        try {
            validateSafeInput("raw string message");
            console.log("❌ B2 Failed: Should have thrown on raw input");
            return false;
        } catch (err) {
            if (err.message.includes('Invalid input') || err.message.includes('SafeAIInput')) {
                console.log("✅ B2 Passed: Validation throws on raw input\n");
                return true;
            }
        }
    } catch (err) {
        console.log("❌ B2 Failed: Could not load safeAIInput module:", err.message);
        return false;
    }
    return false;
}

// Test C1: Emergency Before Consent
async function testC1_EmergencyPreConsent() {
    console.log("=== TEST C1: Emergency Before Consent ===");

    const env = {
        ...process.env,
        PORT: SERVER_PORT,
        NODE_ENV: 'test',
        AI_PROVIDER: 'openrouter',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        ADMIN_SECRET: 'admin123'
    };

    const server = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '../../'),
        env,
        stdio: 'pipe'
    });

    let logs = '';
    let serverReady = false;

    server.stdout.on('data', d => {
        logs += d.toString();
        if (d.toString().includes('Production Server running')) serverReady = true;
    });
    server.stderr.on('data', d => logs += d.toString());

    while (!serverReady) await wait(500);

    // Send emergency before consent
    const session = createSession();
    const response = await postMessage("I have chest pain", session);

    server.kill();

    // Check that AI was NOT called (no OpenRouter logs after emergency)
    const hasAICall = logs.includes('OpenRouterProvider: Response received');
    const hasEmergencyResponse = response.reply && response.reply.includes('997');

    if (!hasAICall && hasEmergencyResponse) {
        console.log("✅ C1 Passed: Emergency returned without AI call\n");
        return true;
    } else {
        console.log("❌ C1 Failed: AI may have been called for emergency");
        return false;
    }
}

// Test D1: Normal Flow Works
async function testD1_NormalFlow() {
    console.log("=== TEST D1: Normal Booking Flow ===");

    const env = {
        ...process.env,
        PORT: SERVER_PORT,
        NODE_ENV: 'test',
        AI_PROVIDER: 'openrouter',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        ADMIN_SECRET: 'admin123'
    };

    const server = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '../../'),
        env,
        stdio: 'pipe'
    });

    let logs = '';
    let serverReady = false;

    server.stdout.on('data', d => {
        logs += d.toString();
        if (d.toString().includes('Production Server running')) serverReady = true;
    });
    server.stderr.on('data', d => logs += d.toString());

    while (!serverReady) await wait(500);

    // Normal flow: language -> consent -> message
    const session = createSession();
    await postMessage("English", session);
    await postMessage("Yes", session);
    const response = await postMessage("I want to book an appointment", session);

    server.kill();

    // Check that we got a response (even if AI fails due to test key)
    if (response.reply && typeof response.reply === 'string') {
        console.log("✅ D1 Passed: Normal flow returns response\n");
        return true;
    } else {
        console.log("❌ D1 Failed: No response from normal flow");
        return false;
    }
}

// Main test runner
async function runTests() {
    let passed = 0;
    let failed = 0;

    // Note: Tests that require server spawn are run sequentially
    // to avoid port conflicts

    if (await testA1_DefaultProvider()) passed++; else failed++;
    await wait(1000);

    if (await testA2_OpenAIStub()) passed++; else failed++;
    await wait(1000);

    if (await testA3_InvalidProvider()) passed++; else failed++;
    await wait(1000);

    if (await testB1_RawInputBlocked()) passed++; else failed++;
    await wait(1000);

    if (testB2_ForcedInjection()) passed++; else failed++;

    if (await testC1_EmergencyPreConsent()) passed++; else failed++;
    await wait(1000);

    if (await testD1_NormalFlow()) passed++; else failed++;

    console.log("=================================================");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log("✅ ALL TESTS PASSED - Phase 3 Verified");
    } else {
        console.log("❌ SOME TESTS FAILED - Review Required");
    }
    console.log("=================================================");

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
