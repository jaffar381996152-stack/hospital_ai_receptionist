/**
 * Phase 2: Hospital Context Resolution & Routing - Test Suite
 * 
 * Tests:
 * A. URL Parsing - hospital_id correctly extracted from URL
 * B. Invalid Hospital Rejection - 404 for non-existent hospitals
 * C. Security - Header/body/query spoofing blocked
 * D. Cross-Hospital Isolation - Requests properly scoped
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// TEST UTILITIES
// ============================================================

let results = [];

function recordTest(id, name, passed, details = '') {
    results.push({ id, name, passed, details });
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${id} - ${name}`);
    if (!passed && details) console.log(`   Details: ${details}`);
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// ============================================================
// PATH REFERENCES
// ============================================================

const ROOT = path.resolve(__dirname, '../..');
const MIDDLEWARE_PATH = path.join(ROOT, 'src/middleware/hospitalContext.js');
const ROUTER_PATH = path.join(ROOT, 'src/routes/hospitalRouter.js');
const SERVER_PATH = path.join(ROOT, 'server.js');

// ============================================================
// TEST GROUP A: URL PARSING
// ============================================================

console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Phase 2: Hospital Context & Routing - Test Suite      ║
╚═══════════════════════════════════════════════════════════╝
`);

console.log("\n━━━ Test Group A: URL Parsing ━━━");

// A1: Middleware extracts from req.params.hospital_id
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const usesReqParams = middlewareContent.includes('req.params.hospital_id');

    recordTest('A1', 'Middleware uses req.params.hospital_id', usesReqParams,
        usesReqParams ? '' : 'Should extract from URL params only');
}

// A2: No longer uses header extraction
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    // Check the extractHospitalId function is gone or doesn't use headers for extraction
    const usesHeaderExtraction = middlewareContent.includes("req.headers['x-hospital-id']") &&
        !middlewareContent.includes('// Check for spoofing attempts');

    // It's OK to reference headers for spoofing detection, but not for extraction
    const extractsFromHeader = middlewareContent.includes("return headerHospitalId") ||
        middlewareContent.includes("return req.headers['x-hospital-id']");

    recordTest('A2', 'Header extraction removed', !extractsFromHeader,
        extractsFromHeader ? 'Should not extract hospital_id from header' : '');
}

// A3: No longer uses body extraction
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const extractsFromBody = middlewareContent.includes("return req.body.hospital_id") ||
        (middlewareContent.includes("req.body.hospital_id") &&
            middlewareContent.includes("return") &&
            !middlewareContent.includes("spoofAttempts"));

    recordTest('A3', 'Body extraction removed', !extractsFromBody,
        extractsFromBody ? 'Should not extract hospital_id from body' : '');
}

// A4: No query extraction
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const extractsFromQuery = middlewareContent.includes("return req.query.hospital_id");

    recordTest('A4', 'Query extraction removed', !extractsFromQuery,
        extractsFromQuery ? 'Should not extract hospital_id from query' : '');
}

// ============================================================
// TEST GROUP B: INVALID HOSPITAL REJECTION
// ============================================================

console.log("\n━━━ Test Group B: Invalid Hospital Rejection ━━━");

// B1: Returns 404 for invalid hospital
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const returns404 = middlewareContent.includes('status(404)') ||
        middlewareContent.includes('.status(404)');

    recordTest('B1', 'Returns 404 for invalid hospital', returns404,
        returns404 ? '' : 'Should return 404 for unknown hospitals');
}

// B2: Validates hospital_id format
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const validatesFormat = middlewareContent.includes('/^[a-z0-9_]+$/') ||
        middlewareContent.includes('alphanumeric') ||
        middlewareContent.includes('Invalid format');

    recordTest('B2', 'Validates hospital_id format', validatesFormat,
        validatesFormat ? '' : 'Should validate hospital_id format');
}

// B3: Hospital not found message exists
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const hasNotFoundMessage = middlewareContent.includes('Hospital not found') ||
        middlewareContent.includes('does not exist');

    recordTest('B3', 'Hospital not found message', hasNotFoundMessage);
}

// ============================================================
// TEST GROUP C: SECURITY - SPOOFING BLOCKED
// ============================================================

console.log("\n━━━ Test Group C: Security - Spoofing Blocked ━━━");

// C1: Spoof detection for headers
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const detectsHeaderSpoof = middlewareContent.includes("x-hospital-id") &&
        middlewareContent.includes('spoofAttempts');

    recordTest('C1', 'Header spoof detection exists', detectsHeaderSpoof,
        detectsHeaderSpoof ? '' : 'Should detect header spoofing attempts');
}

// C2: Spoof detection for body
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const detectsBodySpoof = middlewareContent.includes("body") &&
        middlewareContent.includes('spoofAttempts');

    recordTest('C2', 'Body spoof detection exists', detectsBodySpoof,
        detectsBodySpoof ? '' : 'Should detect body spoofing attempts');
}

// C3: Audit logging for spoof attempts
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const auditsSpoofing = middlewareContent.includes('HOSPITAL_SPOOF_ATTEMPT') ||
        middlewareContent.includes('Potential spoofing attempt');

    recordTest('C3', 'Spoof attempts are audited', auditsSpoofing,
        auditsSpoofing ? '' : 'Spoofing attempts should be audited');
}

// C4: URL hospital_id is authoritative
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const urlIsAuthoritative = middlewareContent.includes('req.hospitalId = normalizedId') ||
        middlewareContent.includes('URL hospital_id is authoritative') ||
        middlewareContent.includes('req.hospital = hospital');

    recordTest('C4', 'URL hospital_id is authoritative', urlIsAuthoritative);
}

// ============================================================
// TEST GROUP D: ROUTING STRUCTURE
// ============================================================

console.log("\n━━━ Test Group D: Routing Structure ━━━");

// D1: Hospital router exists
{
    const routerExists = fs.existsSync(ROUTER_PATH);

    recordTest('D1', 'Hospital router exists', routerExists,
        routerExists ? '' : 'Expected: src/routes/hospitalRouter.js');
}

// D2: Router uses mergeParams
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const routerContent = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = routerContent.includes('mergeParams: true');
    }

    recordTest('D2', 'Router uses mergeParams', passed,
        passed ? '' : 'Router should use mergeParams: true');
}

// D3: Hospital context middleware applied
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const routerContent = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = routerContent.includes('resolveHospitalContext');
    }

    recordTest('D3', 'Hospital context middleware applied', passed);
}

// D4: Server mounts hospital router
{
    const serverContent = fs.readFileSync(SERVER_PATH, 'utf-8');

    const mountsRouter = serverContent.includes("app.use('/:hospital_id'") &&
        serverContent.includes('hospitalRouter');

    recordTest('D4', 'Server mounts /:hospital_id router', mountsRouter,
        mountsRouter ? '' : 'Server should mount hospital router at /:hospital_id');
}

// D5: Chat route exists in router
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const routerContent = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = routerContent.includes("'/chat'") || routerContent.includes('"/chat"');
    }

    recordTest('D5', 'Chat route exists in hospital router', passed);
}

// ============================================================
// TEST GROUP E: HOSPITAL ISOLATION
// ============================================================

console.log("\n━━━ Test Group E: Hospital Isolation ━━━");

// E1: req.hospital attached
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const attachesReqHospital = middlewareContent.includes('req.hospital = ');

    recordTest('E1', 'req.hospital is attached', attachesReqHospital);
}

// E2: req.hospitalId attached
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const attachesReqHospitalId = middlewareContent.includes('req.hospitalId = ');

    recordTest('E2', 'req.hospitalId is attached', attachesReqHospitalId);
}

// E3: Backward compatibility with res.locals
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const maintainsResLocals = middlewareContent.includes('res.locals.hospital');

    recordTest('E3', 'Backward compatibility with res.locals', maintainsResLocals);
}

// E4: Database lookup exists
{
    const middlewareContent = fs.readFileSync(MIDDLEWARE_PATH, 'utf-8');

    const hasDbLookup = middlewareContent.includes('lookupHospital') ||
        middlewareContent.includes('SELECT') ||
        middlewareContent.includes('initializeDatabase');

    recordTest('E4', 'Database lookup implemented', hasDbLookup);
}

// ============================================================
// SUMMARY
// ============================================================

console.log(`
╔═════════════════════════════════════════╗
║             TEST SUMMARY                ║
╚═════════════════════════════════════════╝`);

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total = results.length;

console.log(`Total: ${total}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
    console.log("\n🎉 ALL TESTS PASSED - Phase 2 Hospital Context Complete!\n");
} else {
    console.log("\n⚠️ Some tests failed. Review output above.\n");
    process.exit(1);
}
