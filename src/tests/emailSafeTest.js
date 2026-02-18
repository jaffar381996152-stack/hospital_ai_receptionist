const { spawn } = require('child_process');
const path = require('path');

const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '../../'),
    env: {
        ...process.env,
        PORT: 3006,
        NODE_ENV: 'test',
        SESSION_SECRET: 'test-secret-must-be-very-long-to-pass-validation-which-is-32-chars',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        ADMIN_SECRET: 'admin123',
        OPENROUTER_API_KEY: 'test_key'
    }, // Ensure we have secrets from parent env if set
    stdio: 'pipe'
});

let output = '';
const timeout = setTimeout(() => {
    console.error("Timeout waiting for server startup/warning.");
    server.kill();
    process.exit(1);
}, 10000);

server.stdout.on('data', (data) => {
    const chunk = data.toString();
    output += chunk;
    console.log(chunk);

    if (chunk.includes('WARNING: Email Transport is DISABLED')) {
        console.log("✅ Verified: Email Transport Disabled Warning found.");
        clearTimeout(timeout);
        server.kill();
        process.exit(0);
    }
});

server.stderr.on('data', (data) => {
    console.error(data.toString());
});

server.on('close', (code) => {
    if (code !== 0 && !output.includes('WARNING')) {
        console.error("Server exited unexpectedly without warning.");
        process.exit(1);
    }
});
