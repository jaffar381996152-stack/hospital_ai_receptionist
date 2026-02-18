/**
 * Hospital Isolation Integration Test
 * 
 * Tests:
 * 1. Language selection via dedicated /set-language endpoint
 * 2. Consent via dedicated /set-consent endpoint
 * 3. Session isolation between hospitals (Riyadh vs Jeddah)
 * 4. Session status endpoint
 */

const http = require('http');

const BASE = 'http://localhost:3000';

class TestClient {
    constructor(name) {
        this.name = name;
        this.cookies = '';
    }

    async request(method, path, body = null) {
        return new Promise((resolve, reject) => {
            const url = new URL(path, BASE);
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.cookies ? { 'Cookie': this.cookies } : {})
                }
            };

            const req = http.request(options, (res) => {
                // Store cookies
                const setCookie = res.headers['set-cookie'];
                if (setCookie) {
                    this.cookies = setCookie.map(c => c.split(';')[0]).join('; ');
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) });
                    } catch (e) {
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    }
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) {
        console.log(`  ✅ ${msg}`);
        passed++;
    } else {
        console.log(`  ❌ FAILED: ${msg}`);
        failed++;
    }
}

async function runTests() {
    console.log('\n=== Hospital Isolation Integration Tests ===\n');

    const clientA = new TestClient('Riyadh Client');
    const clientB = new TestClient('Jeddah Client');

    // --- Test 1: Language Selection via Button Endpoint ---
    console.log('TEST 1: Language Selection via /set-language');
    const langResult = await clientA.request('POST', '/hospital_riyadh/set-language', { language: 'English' });
    assert(langResult.status === 200, `Status 200 (got ${langResult.status})`);
    assert(langResult.body.success === true, `success: true (got ${langResult.body.success})`);
    assert(langResult.body.language === 'English', `language: English (got ${langResult.body.language})`);
    assert(langResult.body.needsConsent === true, `needsConsent: true (got ${langResult.body.needsConsent})`);
    assert(langResult.body.message === 'Language set to English', `message correct (got ${langResult.body.message})`);

    // --- Test 2: Session Status Before Consent ---
    console.log('\nTEST 2: Session Status (before consent)');
    const statusBefore = await clientA.request('GET', '/hospital_riyadh/session-status');
    assert(statusBefore.body.language === 'English', `language persisted in session (got ${statusBefore.body.language})`);
    assert(statusBefore.body.consentGiven === false, `consent not yet given (got ${statusBefore.body.consentGiven})`);

    // --- Test 3: Consent via Button Endpoint (Yes) ---
    console.log('\nTEST 3: Consent Grant via /set-consent');
    const consentResult = await clientA.request('POST', '/hospital_riyadh/set-consent', { consent: true });
    assert(consentResult.status === 200, `Status 200 (got ${consentResult.status})`);
    assert(consentResult.body.consentGiven === true, `consentGiven: true (got ${consentResult.body.consentGiven})`);
    assert(consentResult.body.message.includes('Al Shifa'), `Welcome references hospital name (got "${consentResult.body.message.substring(0, 80)}...")`);

    // --- Test 4: Session Status After Consent ---
    console.log('\nTEST 4: Session Status (after consent)');
    const statusAfter = await clientA.request('GET', '/hospital_riyadh/session-status');
    assert(statusAfter.body.language === 'English', `language still English`);
    assert(statusAfter.body.consentGiven === true, `consent now given`);

    // --- Test 5: Hospital Isolation (Jeddah client is separate) ---
    console.log('\nTEST 5: Hospital Isolation (Jeddah is fresh - different client)');
    const jeddahStatus = await clientB.request('GET', '/hospital_jeddah/session-status');
    assert(jeddahStatus.body.language === null, `Jeddah has NO language set (got ${jeddahStatus.body.language})`);
    assert(jeddahStatus.body.consentGiven === false, `Jeddah has NO consent (got ${jeddahStatus.body.consentGiven})`);

    // --- Test 6: Same-browser isolation (same cookies, different hospital) ---
    console.log('\nTEST 6: Same-browser isolation (Riyadh client accessing Jeddah)');
    const jeddahViaRiyadh = await clientA.request('GET', '/hospital_jeddah/session-status');
    assert(jeddahViaRiyadh.body.language === null, `Jeddah via Riyadh's cookies has NO language (got ${jeddahViaRiyadh.body.language})`);
    assert(jeddahViaRiyadh.body.consentGiven === false, `Jeddah via Riyadh's cookies has NO consent (got ${jeddahViaRiyadh.body.consentGiven})`);

    // But Riyadh should still have its state
    const riyadhStill = await clientA.request('GET', '/hospital_riyadh/session-status');
    assert(riyadhStill.body.language === 'English', `Riyadh still has English after Jeddah access`);
    assert(riyadhStill.body.consentGiven === true, `Riyadh still has consent after Jeddah access`);

    // --- Test 7: Consent Denial ---
    console.log('\nTEST 7: Consent Denial');
    await clientA.request('POST', '/hospital_jeddah/set-language', { language: 'Arabic' });
    const denyResult = await clientA.request('POST', '/hospital_jeddah/set-consent', { consent: false });
    assert(denyResult.body.consentGiven === false, `consent denied (got ${denyResult.body.consentGiven})`);
    assert(denyResult.body.message.includes('denied') || denyResult.body.message.includes('رفض'), `denial message (got "${denyResult.body.message.substring(0, 60)}...")`);

    // --- Test 8: Invalid Language ---
    console.log('\nTEST 8: Invalid Language Rejection');
    const invalidLang = await clientB.request('POST', '/hospital_jeddah/set-language', { language: 'French' });
    assert(invalidLang.status === 400, `Status 400 for invalid language (got ${invalidLang.status})`);
    assert(invalidLang.body.error === 'Invalid language', `Error message correct (got ${invalidLang.body.error})`);

    // --- Test 9: Arabic Language ---
    console.log('\nTEST 9: Arabic Language Selection');
    const arabicResult = await clientB.request('POST', '/hospital_jeddah/set-language', { language: 'Arabic' });
    assert(arabicResult.body.message === 'تم تعيين اللغة العربية', `Arabic confirmation (got ${arabicResult.body.message})`);

    // --- Summary ---
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log(`${'='.repeat(50)}\n`);

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test Error:', err);
    process.exit(1);
});
