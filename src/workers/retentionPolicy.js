const db = require('../config/db');
const { logger } = require('../config/logger');

// Retention Rules (Configurable)
const RETENTION_YEARS = 7;
const SLOT_RETENTION_MONTHS = 12;

const runRetentionPolicy = async () => {
    logger.info('Running Data Retention Policy...');

    try {
        // 1. Delete old completed bookings (7 years+)
        const resultBooking = await db.execute(`
            DELETE FROM bookings 
            WHERE created_at < datetime('now', '-${RETENTION_YEARS} years')
        `);
        if (resultBooking.changes > 0) logger.info(`Retention: Deleted ${resultBooking.changes} old bookings.`);

        // 2. Delete old unused slots (12 months+)
        const resultSlots = await db.execute(`
            DELETE FROM slots 
            WHERE start_time < datetime('now', '-${SLOT_RETENTION_MONTHS} months')
            AND is_booked = 0
        `);
        if (resultSlots.changes > 0) logger.info(`Retention: Deleted ${resultSlots.changes} old slots.`);

    } catch (err) {
        logger.error('Retention Policy Failed', err);
    }
};

// If run directly
if (require.main === module) {
    runRetentionPolicy();
}

module.exports = runRetentionPolicy;
