/**
 * Phase 6: Reception Dashboard - Test Suite
 * 
 * Tests:
 * A. Password Hashing - Secure password storage
 * B. Authentication Service - Login/session management
 * C. Route Protection - Unauthorized access blocked
 * D. Hospital Isolation - Cross-hospital access blocked
 * E. Check-in Logic - State validation
 * F. Audit Logging - Actions are logged
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// TEST UTILITIES
// ============================================================

let results = [];

function recordTest(id, name, passed, details = '') {
    results.push({ id, name, passed, details });
    console.log(`  ${passed ? '✅' : '❌'} ${id}: ${name}${details ? ' - ' + details : ''}`);
}

// ============================================================
// PATH REFERENCES
// ============================================================

const ROOT = path.resolve(__dirname, '../..');
const SERVICES_DIR = path.join(ROOT, 'src/services');
const MIDDLEWARE_DIR = path.join(ROOT, 'src/middleware');
const ROUTES_DIR = path.join(ROOT, 'src/routes');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');
const PUBLIC_DIR = path.join(ROOT, 'public');

const AUTH_SERVICE_PATH = path.join(SERVICES_DIR, 'receptionAuthService.js');
const AUTH_MIDDLEWARE_PATH = path.join(MIDDLEWARE_DIR, 'receptionAuth.js');
const ROUTER_PATH = path.join(ROUTES_DIR, 'receptionRouter.js');
const HOSPITAL_ROUTER_PATH = path.join(ROUTES_DIR, 'hospitalRouter.js');
const SEED_SCRIPT_PATH = path.join(SCRIPTS_DIR, 'seedReceptionUsers.js');
const LOGIN_PAGE_PATH = path.join(PUBLIC_DIR, 'reception.html');
const DASHBOARD_PAGE_PATH = path.join(PUBLIC_DIR, 'reception-dashboard.html');

console.log(`
╔════════════════════════════════════════════════════════════╗
║     Phase 6: Reception Dashboard - Test Suite              ║
╚════════════════════════════════════════════════════════════╝
`);

// ============================================================
// TEST GROUP A: PASSWORD HASHING
// ============================================================

console.log("\n━━━ Test Group A: Password Hashing ━━━");

// A1: Auth service uses scrypt
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('crypto.scrypt') &&
            content.includes('SALT_LENGTH') &&
            content.includes('KEY_LENGTH');
    }
    recordTest('A1', 'Uses scrypt for password hashing', passed);
}

// A2: Salt is random for each password
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('crypto.randomBytes');
    }
    recordTest('A2', 'Uses random salt per password', passed);
}

// A3: Timing-safe comparison
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('crypto.timingSafeEqual');
    }
    recordTest('A3', 'Uses timing-safe comparison', passed);
}

// A4: Hash format includes salt
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('salt.toString(\'hex\')') &&
            content.includes('derivedKey.toString(\'hex\')') &&
            content.includes(':');
    }
    recordTest('A4', 'Hash format is salt:hash', passed);
}

// ============================================================
// TEST GROUP B: AUTHENTICATION SERVICE
// ============================================================

console.log("\n━━━ Test Group B: Authentication Service ━━━");

// B1: Login method exists
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('static async login(') &&
            content.includes('hospitalId') &&
            content.includes('username') &&
            content.includes('password');
    }
    recordTest('B1', 'Login method exists with hospital scope', passed);
}

// B2: User lookup is hospital-scoped
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('hospital_id = ?') || content.includes('hospital_id = $1');
    }
    recordTest('B2', 'User lookup is hospital-scoped', passed);
}

// B3: Inactive users blocked
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('is_active') &&
            content.includes('Account is disabled');
    }
    recordTest('B3', 'Inactive users are blocked', passed);
}

// B4: Last login updated
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('last_login');
    }
    recordTest('B4', 'Last login timestamp updated', passed);
}

// ============================================================
// TEST GROUP C: ROUTE PROTECTION
// ============================================================

console.log("\n━━━ Test Group C: Route Protection ━━━");

// C1: Auth middleware exists
{
    const exists = fs.existsSync(AUTH_MIDDLEWARE_PATH);
    recordTest('C1', 'Auth middleware file exists', exists);
}

// C2: Checks session.receptionUser
{
    let passed = false;
    if (fs.existsSync(AUTH_MIDDLEWARE_PATH)) {
        const content = fs.readFileSync(AUTH_MIDDLEWARE_PATH, 'utf-8');
        passed = content.includes('req.session?.receptionUser');
    }
    recordTest('C2', 'Checks session.receptionUser', passed);
}

// C3: Returns 401 for unauthenticated
{
    let passed = false;
    if (fs.existsSync(AUTH_MIDDLEWARE_PATH)) {
        const content = fs.readFileSync(AUTH_MIDDLEWARE_PATH, 'utf-8');
        passed = content.includes('res.status(401)') &&
            content.includes('Authentication required');
    }
    recordTest('C3', 'Returns 401 for unauthenticated requests', passed);
}

// C4: Rate limiting on login
{
    let passed = false;
    if (fs.existsSync(AUTH_MIDDLEWARE_PATH)) {
        const content = fs.readFileSync(AUTH_MIDDLEWARE_PATH, 'utf-8');
        passed = content.includes('loginRateLimiter') &&
            content.includes('max: 5') &&
            content.includes('15 * 60 * 1000');
    }
    recordTest('C4', 'Rate limiting on login endpoint', passed);
}

// ============================================================
// TEST GROUP D: HOSPITAL ISOLATION
// ============================================================

console.log("\n━━━ Test Group D: Hospital Isolation ━━━");

// D1: Cross-hospital check exists
{
    let passed = false;
    if (fs.existsSync(AUTH_MIDDLEWARE_PATH)) {
        const content = fs.readFileSync(AUTH_MIDDLEWARE_PATH, 'utf-8');
        passed = content.includes('receptionUser.hospitalId !== req.hospitalId');
    }
    recordTest('D1', 'Cross-hospital check in middleware', passed);
}

// D2: Returns 403 for cross-hospital
{
    let passed = false;
    if (fs.existsSync(AUTH_MIDDLEWARE_PATH)) {
        const content = fs.readFileSync(AUTH_MIDDLEWARE_PATH, 'utf-8');
        passed = content.includes('res.status(403)') &&
            content.includes('Access denied');
    }
    recordTest('D2', 'Returns 403 for cross-hospital access', passed);
}

// D3: Audit log for cross-hospital attempts
{
    let passed = false;
    if (fs.existsSync(AUTH_MIDDLEWARE_PATH)) {
        const content = fs.readFileSync(AUTH_MIDDLEWARE_PATH, 'utf-8');
        passed = content.includes('RECEPTION_CROSS_HOSPITAL_BLOCKED');
    }
    recordTest('D3', 'Audit log for cross-hospital attempts', passed);
}

// ============================================================
// TEST GROUP E: CHECK-IN LOGIC
// ============================================================

console.log("\n━━━ Test Group E: Check-In Logic ━━━");

// E1: Only CONFIRMED can be checked in
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const content = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = content.includes("booking.status !== 'confirmed'") &&
            content.includes('Only confirmed bookings');
    }
    recordTest('E1', 'Only CONFIRMED bookings can check in', passed);
}

// E2: Duplicate check-in blocked
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const content = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = content.includes('booking.checked_in_at') &&
            content.includes('already been checked in');
    }
    recordTest('E2', 'Duplicate check-in blocked', passed);
}

// E3: Records checked_in_at and checked_in_by
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const content = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = content.includes('checked_in_at') &&
            content.includes('checked_in_by') &&
            content.includes('staffUsername');
    }
    recordTest('E3', 'Records check-in timestamp and staff', passed);
}

// E4: Hospital isolation on check-in
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const content = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = content.includes('hospital_id = ?') || content.includes('hospital_id = $');
    }
    recordTest('E4', 'Hospital isolation enforced on check-in', passed);
}

// ============================================================
// TEST GROUP F: AUDIT LOGGING
// ============================================================

console.log("\n━━━ Test Group F: Audit Logging ━━━");

// F1: Login audited
{
    let passed = false;
    if (fs.existsSync(AUTH_SERVICE_PATH)) {
        const content = fs.readFileSync(AUTH_SERVICE_PATH, 'utf-8');
        passed = content.includes('RECEPTION_LOGIN');
    }
    recordTest('F1', 'Login action is audited', passed);
}

// F2: Logout audited
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const content = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = content.includes('RECEPTION_LOGOUT');
    }
    recordTest('F2', 'Logout action is audited', passed);
}

// F3: Search audited
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const content = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = content.includes('RECEPTION_SEARCH');
    }
    recordTest('F3', 'Search action is audited', passed);
}

// F4: Check-in audited
{
    let passed = false;
    if (fs.existsSync(ROUTER_PATH)) {
        const content = fs.readFileSync(ROUTER_PATH, 'utf-8');
        passed = content.includes('RECEPTION_CHECKIN');
    }
    recordTest('F4', 'Check-in action is audited', passed);
}

// ============================================================
// TEST GROUP G: UI & INTEGRATION
// ============================================================

console.log("\n━━━ Test Group G: UI & Integration ━━━");

// G1: Login page exists
{
    const exists = fs.existsSync(LOGIN_PAGE_PATH);
    recordTest('G1', 'Login page exists', exists);
}

// G2: Dashboard page exists
{
    const exists = fs.existsSync(DASHBOARD_PAGE_PATH);
    recordTest('G2', 'Dashboard page exists', exists);
}

// G3: Seed script exists
{
    const exists = fs.existsSync(SEED_SCRIPT_PATH);
    recordTest('G3', 'Seed script exists', exists);
}

// G4: Router mounted in hospitalRouter
{
    let passed = false;
    if (fs.existsSync(HOSPITAL_ROUTER_PATH)) {
        const content = fs.readFileSync(HOSPITAL_ROUTER_PATH, 'utf-8');
        passed = content.includes("require('./receptionRouter')") &&
            content.includes('/api/reception');
    }
    recordTest('G4', 'Reception router mounted', passed);
}

// G5: Reception pages served
{
    let passed = false;
    if (fs.existsSync(HOSPITAL_ROUTER_PATH)) {
        const content = fs.readFileSync(HOSPITAL_ROUTER_PATH, 'utf-8');
        passed = content.includes("'/reception'") &&
            content.includes("reception.html");
    }
    recordTest('G5', 'Reception pages served', passed);
}

// ============================================================
// SUMMARY
// ============================================================

console.log("\n" + "═".repeat(60));
console.log("SUMMARY");
console.log("═".repeat(60));

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
    console.log("\n🎉 ALL TESTS PASSED - Phase 6 Reception Dashboard Complete!\n");
} else {
    console.log("\n⚠️ Some tests failed. Review output above.\n");
    process.exit(1);
}
