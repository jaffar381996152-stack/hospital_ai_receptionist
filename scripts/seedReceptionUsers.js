/**
 * Seed Reception Users - Phase 6
 * 
 * Creates initial reception staff users for testing.
 * 
 * Usage:
 *   node scripts/seedReceptionUsers.js
 * 
 * Creates users for each hospital:
 *   - reception / reception123
 *   - admin / admin123
 */

require('dotenv').config();
const { initializeDatabase } = require('../src/config/productionDb');
const ReceptionAuthService = require('../src/services/receptionAuthService');
const { logger } = require('../src/config/logger');

const SEED_USERS = [
    // Default hospital
    { hospitalId: 'default', username: 'reception', password: 'reception123', role: 'receptionist' },
    { hospitalId: 'default', username: 'admin', password: 'admin123', role: 'admin' },

    // Riyadh hospital
    { hospitalId: 'hospital_riyadh', username: 'reception', password: 'reception123', role: 'receptionist' },
    { hospitalId: 'hospital_riyadh', username: 'admin', password: 'admin123', role: 'admin' },

    // Jeddah hospital
    { hospitalId: 'hospital_jeddah', username: 'reception', password: 'reception123', role: 'receptionist' },
    { hospitalId: 'hospital_jeddah', username: 'admin', password: 'admin123', role: 'admin' },
];

async function seedUsers() {
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║     Seeding Reception Users - Phase 6              ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    try {
        // Initialize database
        await initializeDatabase();
        console.log('✅ Database initialized\n');

        for (const user of SEED_USERS) {
            console.log(`Creating: ${user.username}@${user.hospitalId} (${user.role})`);

            const result = await ReceptionAuthService.createUser({
                hospitalId: user.hospitalId,
                username: user.username,
                password: user.password,
                role: user.role
            });

            if (result.success) {
                console.log(`  ✅ Created with ID: ${result.userId}`);
            } else {
                console.log(`  ⚠️ ${result.error}`);
            }
        }

        console.log('\n════════════════════════════════════════════════════');
        console.log('SEED COMPLETE');
        console.log('════════════════════════════════════════════════════');
        console.log('\nTest credentials:');
        console.log('  Username: reception');
        console.log('  Password: reception123');
        console.log('\nAdmin credentials:');
        console.log('  Username: admin');
        console.log('  Password: admin123');
        console.log('\nAccess via: http://localhost:3000/{hospital_id}/reception');

    } catch (err) {
        console.error('❌ Seed failed:', err.message);
        process.exit(1);
    }

    process.exit(0);
}

seedUsers();
