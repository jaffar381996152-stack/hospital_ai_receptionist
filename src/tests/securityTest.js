const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const crypto = require('crypto');

// Unit Test Utils imports
const { encrypt, decrypt } = require('../utils/encryption');
const aiservice = require('../services/aiService'); // For testing key logic

const SERVER_PORT = 3003;
const API_URL = `http://localhost:${SERVER_PORT}`;

console.log("--- Starting Security Verification ---");

// --- 1. Unit Tests ---
console.log("\n[1] Testing Encryption Utility...");
const testText = "Sensitive Patient Data";
const encrypted = encrypt(testText);
const decrypted = decrypt(encrypted);

if (encrypted !== testText && decrypted === testText) {
    console.log("✅ Encryption/Decryption works.");
} else {
    console.error("❌ Encryption Failed:", { encrypted, decrypted });
}

console.log("\n[2] Testing AI Key Rotation Logic...");
// Mock process env for test logic (AIService already initialized, so we test its internals if accessible or mock)
// Since we can't easily re-init the singleton with different env without reload, we check the logic method.
aiservice.apiKeys = ['key1', 'key2'];
aiservice.currentKeyIndex = 0;
const k1 = aiservice.getKey();
aiservice.rotateKey();
const k2 = aiservice.getKey();
if (k1 === 'key1' && k2 === 'key2') {
    console.log("✅ Key Rotation Logic works.");
} else {
    console.error("❌ Key Rotation Failed:", { k1, k2 });
}


// --- 2. Integration Tests ---
const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '../../'),
    env: { ...process.env, PORT: SERVER_PORT, NODE_ENV: 'test', ADMIN_SECRET: 'supersecret123' },
    stdio: 'inherit'
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function runIntegration() {
    try {
        console.log("\nWaiting for server...");
        await wait(3000);

        // [3] Request ID Traceability
        console.log("\n[3] Testing Request ID...");
        const resHealth = await axios.get(`${API_URL}/health`);
        const reqId = resHealth.headers['x-request-id'];
        if (reqId && reqId.length > 10) {
            console.log("✅ Request ID Header present:", reqId);
        } else {
            console.error("❌ Missing X-Request-ID.");
        }

        // [4] RBAC Protection
        console.log("\n[4] Testing RBAC...");

        // 4a. Fail without token
        try {
            await axios.get(`${API_URL}/admin/logs`);
            console.error("❌ RBAC Failed: Allowed access without token.");
        } catch (e) {
            if (e.response && e.response.status === 403) {
                console.log("✅ RBAC Denied access without token (403).");
            } else {
                console.error("❌ RBAC Unexpected Error:", e.message);
            }
        }

        // 4b. Fail with bad token
        try {
            await axios.get(`${API_URL}/admin/logs`, { headers: { 'X-Admin-Token': 'wrong' } });
            console.error("❌ RBAC Failed: Allowed access with bad token.");
        } catch (e) {
            if (e.response && e.response.status === 403) {
                console.log("✅ RBAC Denied access with bad token (403).");
            } else {
                console.error("❌ RBAC Unexpected Error:", e.message);
            }
        }

        // 4c. Success with correct token
        try {
            const resAdmin = await axios.get(`${API_URL}/admin/logs`, { headers: { 'X-Admin-Token': 'supersecret123' } });
            if (resAdmin.status === 200) {
                console.log("✅ RBAC Granted access with correct token.");
            }
        } catch (e) {
            console.error("❌ RBAC Failed valid request:", e.message);
        }

    } catch (error) {
        console.error("Integration Test Failed:", error.message);
    } finally {
        server.kill();
        process.exit();
    }
}

runIntegration();
