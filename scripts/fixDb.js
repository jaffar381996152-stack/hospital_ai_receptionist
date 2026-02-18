/**
 * Database Fix Script v2
 * 
 * Fixes the hospitals table schema to match migration 003 expectations.
 * Then re-runs all pending migrations.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { initializeDatabase, closeDatabase } = require('../src/config/productionDb');
const { runMigrations } = require('../src/config/migrationRunner');

async function main() {
    console.log('=== Database Fix Script v2 ===\n');

    const db = await initializeDatabase();

    // 1. Check existing hospitals table
    console.log('1. Checking hospitals table...');
    try {
        const cols = await db.query(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'hospitals' ORDER BY ordinal_position`
        );
        console.log('   Current columns:', cols.map(c => `${c.column_name}(${c.data_type})`).join(', '));

        const data = await db.query('SELECT * FROM hospitals');
        console.log('   Rows:', data.length);
        if (data.length > 0) console.log('   Sample:', JSON.stringify(data[0]));

        const colNames = cols.map(c => c.column_name);

        if (!colNames.includes('hospital_id')) {
            console.log('\n   ⚠️  hospitals table missing hospital_id column.');
            console.log('   Need to rebuild with correct schema.\n');

            // Check what the current PK column is
            const pkResult = await db.query(`
                SELECT a.attname 
                FROM pg_index i 
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) 
                WHERE i.indrelid = 'hospitals'::regclass AND i.indisprimary
            `);
            console.log('   Current PK column:', pkResult.map(r => r.attname).join(', '));

            // Save existing data
            const existingData = await db.query('SELECT * FROM hospitals');
            console.log('   Backing up', existingData.length, 'rows...');

            // Drop dependent foreign keys first (tables that reference hospitals)
            console.log('   Dropping tables that reference hospitals...');
            const dependentTables = ['staff_users', 'appointments', 'doctors_v2', 'departments'];
            for (const table of dependentTables) {
                try {
                    await db.execute(`DROP TABLE IF EXISTS ${table} CASCADE`);
                    console.log(`   Dropped ${table}`);
                } catch (e) {
                    console.log(`   ${table} doesn't exist or already dropped`);
                }
            }

            // Also drop doctor_availability since it references doctors_v2
            try {
                await db.execute('DROP TABLE IF EXISTS doctor_availability CASCADE');
                console.log('   Dropped doctor_availability');
            } catch (e) { }

            // Drop and recreate hospitals with correct schema
            console.log('   Dropping old hospitals table...');
            await db.execute('DROP TABLE IF EXISTS hospitals CASCADE');

            console.log('   Creating hospitals with correct schema...');
            await db.execute(`
                CREATE TABLE hospitals (
                    hospital_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    timezone TEXT DEFAULT 'Asia/Riyadh',
                    contact_email TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);
            console.log('   ✅ hospitals table recreated');

            // Re-insert data (map old columns to new)
            for (const row of existingData) {
                const hospitalId = row.hospital_id || row.id || row.slug || 'default';
                const name = row.name || 'Hospital';
                try {
                    await db.execute(
                        `INSERT INTO hospitals (hospital_id, name, timezone, contact_email) VALUES ($1, $2, $3, $4) ON CONFLICT (hospital_id) DO NOTHING`,
                        [hospitalId, name, row.timezone || 'Asia/Riyadh', row.contact_email || null]
                    );
                    console.log(`   Re-inserted hospital: ${hospitalId} (${name})`);
                } catch (e) {
                    console.log(`   Failed to re-insert: ${e.message}`);
                }
            }

            // Remove migration 003 from schema_migrations so it runs fresh
            console.log('   Removing migration 003 record so it re-runs...');
            try {
                await db.execute('DELETE FROM schema_migrations WHERE version = 3');
                await db.execute('DELETE FROM schema_migrations WHERE version = 4');
                await db.execute('DELETE FROM schema_migrations WHERE version = 5');
                await db.execute('DELETE FROM schema_migrations WHERE version = 6');
            } catch (e) {
                console.log('   Note:', e.message);
            }
        } else {
            console.log('   ✅ hospitals table has correct schema');
        }
    } catch (e) {
        console.log('   hospitals table error:', e.message);
    }

    // 2. Also drop old audit_logs if it has wrong schema
    console.log('\n2. Checking audit_logs table...');
    try {
        const cols = await db.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_logs' ORDER BY ordinal_position`
        );
        const colNames = cols.map(c => c.column_name);
        console.log('   Columns:', colNames.join(', '));

        if (!colNames.includes('entity_type')) {
            console.log('   ⚠️  audit_logs has old schema, dropping for migration 006 to recreate...');
            await db.execute('DROP TABLE IF EXISTS audit_logs CASCADE');
            console.log('   ✅ Dropped old audit_logs');
        } else {
            console.log('   ✅ audit_logs has correct schema');
        }
    } catch (e) {
        console.log('   audit_logs check error:', e.message);
    }

    // 3. Run all pending migrations
    console.log('\n3. Running pending migrations...');
    try {
        const result = await runMigrations(db);
        console.log(`   ✅ Applied ${result.applied} of ${result.total} migrations`);
    } catch (e) {
        console.log('   ❌ Migration error:', e.message);
    }

    // 4. Final check
    console.log('\n4. Final state:');
    const tables = await db.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    console.log('   Tables:', tables.map(t => t.table_name).join(', '));

    // Check hospitals data
    try {
        const hospitalData = await db.query('SELECT * FROM hospitals');
        console.log('   Hospitals:', JSON.stringify(hospitalData));
    } catch (e) {
        console.log('   hospitals query error:', e.message);
    }

    await closeDatabase();
    console.log('\n=== Done ===');
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e); process.exit(1); });
