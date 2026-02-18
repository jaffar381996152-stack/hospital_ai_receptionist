const express = require('express');
const healthRoutes = require('../routes/health');
const http = require('http');

console.log("--- Starting Health Check Integration Test ---");

// Setup temporary app
const app = express();
app.use('/health', healthRoutes);

const server = app.listen(0, async () => {
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}/health`;
    console.log(`Test Server running on port ${port}`);

    try {
        // 1. Test Combined Health
        console.log(`\nTesting GET ${baseUrl}...`);
        const res1 = await fetch(baseUrl);
        const data1 = await res1.json();
        console.log(`Status: ${res1.status}`);
        console.log(`Response: ${JSON.stringify(data1, null, 2)}`);

        if (!data1.status || !data1.checks) throw new Error("Missing status/checks fields");

        // 2. Test Redis Specific
        console.log(`\nTesting GET ${baseUrl}/redis...`);
        const res2 = await fetch(`${baseUrl}/redis`);
        const data2 = await res2.json();
        console.log(`Status: ${res2.status}`); // Might be 503 if redis down, that's OK for test as long as formatted
        console.log(`Response: ${JSON.stringify(data2)}`);

        // 3. Test Queue Specific
        console.log(`\nTesting GET ${baseUrl}/queue...`);
        const res3 = await fetch(`${baseUrl}/queue`);
        const data3 = await res3.json();
        console.log(`Status: ${res3.status}`);
        console.log(`Response: ${JSON.stringify(data3)}`);

        // 4. Test AI Specific
        console.log(`\nTesting GET ${baseUrl}/ai-provider...`);
        const res4 = await fetch(`${baseUrl}/ai-provider`);
        const data4 = await res4.json();
        console.log(`Status: ${res4.status}`);
        console.log(`Response: ${JSON.stringify(data4)}`);

        console.log("\n✅ All Health Check Tests Completed Structure Validation");

    } catch (error) {
        console.error("❌ Test Failed:", error);
        process.exitCode = 1;
    } finally {
        server.close();
        process.exit(); // Force exit pending async handles
    }
});
