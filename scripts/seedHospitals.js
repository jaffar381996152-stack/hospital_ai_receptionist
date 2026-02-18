/**
 * Hospital Seed Script
 * 
 * Seeds hospitals from data/hospitals.json into the database.
 * Idempotent - safe to run multiple times (skips existing records).
 * 
 * Usage: npm run seed:hospitals
 */

const path = require('path');
const fs = require('fs');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { initializeDatabase, getDatabase, closeDatabase } = require('../src/config/productionDb');
const { runMigrations } = require('../src/config/migrationRunner');
const { logger } = require('../src/config/logger');

const HOSPITALS_JSON_PATH = path.join(__dirname, '../data/hospitals.json');

/**
 * Load hospitals from JSON file.
 */
function loadHospitalsJson() {
    if (!fs.existsSync(HOSPITALS_JSON_PATH)) {
        throw new Error(`hospitals.json not found at: ${HOSPITALS_JSON_PATH}`);
    }

    const rawData = fs.readFileSync(HOSPITALS_JSON_PATH, 'utf8');
    return JSON.parse(rawData);
}

/**
 * Check if a hospital already exists.
 */
async function hospitalExists(db, hospitalId) {
    try {
        const sql = 'SELECT hospital_id FROM hospitals WHERE hospital_id = $1';
        const result = await db.get(sql, [hospitalId]);
        return !!result;
    } catch (err) {
        // Table might not exist yet
        return false;
    }
}

/**
 * Seed a single hospital and its departments.
 */
async function seedHospital(db, hospitalId, hospitalData) {

    // Check if already exists
    const exists = await hospitalExists(db, hospitalId);
    if (exists) {
        console.log(`  ⏭️  Hospital "${hospitalId}" already exists, skipping...`);
        return { skipped: true };
    }

    // Insert hospital
    const insertHospitalSql = `INSERT INTO hospitals (hospital_id, name, timezone, contact_email) VALUES ($1, $2, $3, $4)`;

    await db.execute(insertHospitalSql, [
        hospitalId,
        hospitalData.name,
        'Asia/Riyadh',
        hospitalData.escalation_contact?.email || null
    ]);

    console.log(`  ✅ Inserted hospital: ${hospitalData.name}`);

    // Insert departments and get their IDs
    const departments = hospitalData.departments || [];
    const departmentIds = {};

    for (const deptName of departments) {
        const insertDeptSql = `INSERT INTO departments (hospital_id, name) VALUES ($1, $2) RETURNING id`;

        try {
            const result = await db.execute(insertDeptSql, [hospitalId, deptName]);
            departmentIds[deptName] = result.rows?.[0]?.id;
            console.log(`     └─ Department: ${deptName}`);
        } catch (err) {
            // Might be duplicate if re-running after partial
            if (err.message?.includes('UNIQUE') || err.code === '23505') {
                console.log(`     └─ Department: ${deptName} (exists)`);
                // Get existing department ID
                const getDeptSql = 'SELECT id FROM departments WHERE hospital_id = $1 AND name = $2';
                const existing = await db.get(getDeptSql, [hospitalId, deptName]);
                if (existing) departmentIds[deptName] = existing.id;
            } else {
                throw err;
            }
        }
    }

    // Seed sample doctors for each department
    let doctorsCreated = 0;
    const doctorNames = {
        'Cardiology': ['Dr. Ahmed Al-Qahtani', 'Dr. Fatima Al-Rashid'],
        'Pediatrics': ['Dr. Mohammed Al-Salem', 'Dr. Noura Al-Harbi'],
        'Dentistry': ['Dr. Khalid Al-Ghamdi', 'Dr. Sara Al-Zahrani'],
        'Orthopedics': ['Dr. Abdul Al-Otaibi', 'Dr. Layla Al-Shehri'],
        'General Medicine': ['Dr. Omar Al-Dossary', 'Dr. Huda Al-Tamimi'],
        'Dermatology': ['Dr. Yusuf Al-Qurashi', 'Dr. Mona Al-Mutairi']
    };

    for (const [deptName, deptId] of Object.entries(departmentIds)) {
        const doctors = doctorNames[deptName] || [`Dr. Sample (${deptName})`];

        for (const doctorName of doctors) {
            const insertDoctorSql = `INSERT INTO doctors_v2 (hospital_id, department_id, name, is_active) VALUES ($1, $2, $3, true) RETURNING id`;

            try {
                const result = await db.execute(insertDoctorSql, [hospitalId, deptId, doctorName]);
                const doctorId = result.rows?.[0]?.id;
                doctorsCreated++;

                // Add availability (Sun-Thu, 09:00-17:00 with lunch break)
                await seedDoctorAvailability(db, doctorId);
            } catch (err) {
                if (err.message?.includes('UNIQUE') || err.code === '23505') {
                    // Doctor already exists
                } else {
                    console.log(`     ⚠️  Failed to create doctor: ${doctorName} - ${err.message}`);
                }
            }
        }
    }

    if (doctorsCreated > 0) {
        console.log(`     └─ Created ${doctorsCreated} doctors with availability`);
    }

    return { skipped: false, departments: departments.length, doctors: doctorsCreated };
}

/**
 * Seed availability for a doctor (Sun-Thu working hours).
 */
async function seedDoctorAvailability(db, doctorId) {
    // Working days: Sunday (0) to Thursday (4)
    // Working hours: 09:00-12:00 and 13:00-17:00 (lunch break)
    const schedule = [
        { day: 0, start: '09:00', end: '12:00' },  // Sunday morning
        { day: 0, start: '13:00', end: '17:00' },  // Sunday afternoon
        { day: 1, start: '09:00', end: '12:00' },  // Monday morning
        { day: 1, start: '13:00', end: '17:00' },  // Monday afternoon
        { day: 2, start: '09:00', end: '12:00' },  // Tuesday morning
        { day: 2, start: '13:00', end: '17:00' },  // Tuesday afternoon
        { day: 3, start: '09:00', end: '12:00' },  // Wednesday morning
        { day: 3, start: '13:00', end: '17:00' },  // Wednesday afternoon
        { day: 4, start: '09:00', end: '12:00' },  // Thursday morning
        { day: 4, start: '13:00', end: '17:00' },  // Thursday afternoon
    ];

    const insertSql = `INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)`;

    for (const slot of schedule) {
        try {
            await db.execute(insertSql, [doctorId, slot.day, slot.start, slot.end]);
        } catch (err) {
            // Ignore duplicates
        }
    }
}

/**
 * Main seed function.
 */
async function seedHospitals() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║           Hospital Seed Script - Phase 1                  ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    console.log(`Database mode: PostgreSQL\n`);

    let db;

    try {
        // Initialize database
        console.log('1. Initializing database connection...');
        db = await initializeDatabase();
        console.log('   ✅ Connected\n');

        // Run migrations first
        console.log('2. Running pending migrations...');
        const migrationResult = await runMigrations(db);
        console.log(`   ✅ Migrations complete (applied: ${migrationResult.applied})\n`);

        // Load hospitals from JSON
        console.log('3. Loading hospitals from hospitals.json...');
        const hospitalsConfig = loadHospitalsJson();
        const hospitalIds = Object.keys(hospitalsConfig);
        console.log(`   Found ${hospitalIds.length} hospitals\n`);

        // Seed each hospital
        console.log('4. Seeding hospitals...');
        let seeded = 0;
        let skipped = 0;
        let totalDepts = 0;

        for (const hospitalId of hospitalIds) {
            const result = await seedHospital(db, hospitalId, hospitalsConfig[hospitalId]);
            if (result.skipped) {
                skipped++;
            } else {
                seeded++;
                totalDepts += result.departments || 0;
            }
        }

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║                    SEED COMPLETE                          ║');
        console.log('╚═══════════════════════════════════════════════════════════╝');
        console.log(`   Hospitals seeded: ${seeded}`);
        console.log(`   Hospitals skipped: ${skipped}`);
        console.log(`   Departments created: ${totalDepts}`);
        console.log('');

    } catch (err) {
        console.error('\n❌ Seed failed:', err.message);
        logger.error('Seed script failed:', err);
        process.exit(1);
    } finally {
        if (db) {
            await closeDatabase();
        }
    }
}

// Run if called directly
if (require.main === module) {
    seedHospitals()
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { seedHospitals, seedHospital, loadHospitalsJson };
