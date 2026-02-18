const redactPhi = require('../middleware/phiRedaction');

// Mock Express Request/Response
const mockNext = () => { };
const mockRes = {
    status: (code) => ({ json: (data) => console.log(`Error ${code}:`, data) })
};

function testRedaction(input, description) {
    const req = { body: { message: input } };

    console.log(`\n--- Test: ${description} ---`);
    console.log(`Original: "${input}"`);

    redactPhi(req, mockRes, mockNext);

    console.log(`Redacted: "${req.body.message}"`);
    console.log(`Raw Saved: "${req.local.rawMessage}"`); // Verify raw is preserved

    return req.body.message;
}

// Test Cases
const tests = [
    {
        desc: "Saudi Phone Number",
        input: "Call me at 0551234567 regarding the appointment."
    },
    {
        desc: "Email Address",
        input: "My email is ahmed@example.com."
    },
    {
        desc: "National ID",
        input: "My ID is 1012345678."
    },
    {
        desc: "Name Extraction",
        input: "My name is Ahmed Ali and I need help."
    },
    {
        desc: "Symptoms (Sensitive)",
        input: "I have chest pain and shortness of breath."
    },
    {
        desc: "Symptoms (General - Should NOT be redacted or handled smartly)",
        // Our regex is strict on specific list, so "headache" might pass if not in list.
        // Let's check behavior.
        input: "I have a headache."
    },
    {
        desc: "Combined PII",
        input: "I am Sarah Connor, 0509999999, email sarah@skynet.com. I have severe bleeding."
    }
];

console.log("Starting PHI Redaction Tests...");

tests.forEach(t => testRedaction(t.input, t.desc));
