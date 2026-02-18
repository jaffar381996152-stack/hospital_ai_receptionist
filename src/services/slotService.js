/**
 * Slot Service - Phase 3
 * 
 * Dynamic slot generation from doctor_availability.
 * Redis-based slot locking with OTP-expiry-matched TTL.
 * 
 * DESIGN:
 * - Slots are NOT stored permanently - computed on demand
 * - Locks are stored in Redis with 10-minute TTL (matches OTP expiry)
 * - Each slot is identified by: hospital_id:doctor_id:datetime
 */

const { initializeDatabase } = require('../config/productionDb');
const redisClient = require('../config/redis');
const { logger } = require('../config/logger');

// Configuration
const DEFAULT_SLOT_DURATION_MINUTES = 15;
const SLOT_LOCK_TTL_SECONDS = 600; // 10 minutes - matches OTP expiry

/**
 * Parse time string (HH:MM) to minutes since midnight.
 * @param {string} timeStr - Time in HH:MM format
 * @returns {number} Minutes since midnight
 */
function parseTimeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

/**
 * Format minutes since midnight to HH:MM.
 * @param {number} minutes - Minutes since midnight
 * @returns {string} Time in HH:MM format
 */
function formatMinutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Get day of week (0=Sunday, 6=Saturday) for a date.
 * @param {Date} date - Date object
 * @returns {number} Day of week
 */
function getDayOfWeek(date) {
    return date.getDay();
}

/**
 * Generate slot key for Redis.
 * @param {string} hospitalId - Hospital ID
 * @param {number} doctorId - Doctor ID
 * @param {string} datetime - Slot datetime (ISO format)
 * @returns {string} Redis key
 */
function getSlotLockKey(hospitalId, doctorId, datetime) {
    return `slotlock:${hospitalId}:${doctorId}:${datetime}`;
}

class SlotService {

    /**
     * Generate time slots from availability window.
     * 
     * @param {string} startTime - Start time (HH:MM)
     * @param {string} endTime - End time (HH:MM)
     * @param {number} slotDurationMinutes - Duration per slot
     * @returns {Array<string>} Array of slot start times (HH:MM)
     */
    static generateSlotsFromWindow(startTime, endTime, slotDurationMinutes = DEFAULT_SLOT_DURATION_MINUTES) {
        const slots = [];
        const startMinutes = parseTimeToMinutes(startTime);
        const endMinutes = parseTimeToMinutes(endTime);

        for (let current = startMinutes; current + slotDurationMinutes <= endMinutes; current += slotDurationMinutes) {
            slots.push(formatMinutesToTime(current));
        }

        return slots;
    }

    /**
     * Get doctor availability for a specific day.
     * 
     * @param {number} doctorId - Doctor ID
     * @param {number} dayOfWeek - Day of week (0=Sunday)
     * @returns {Promise<Array>} Availability records
     */
    static async getDoctorAvailability(doctorId, dayOfWeek) {
        const db = await initializeDatabase();

        const sql = `SELECT * FROM doctor_availability WHERE doctor_id = $1 AND day_of_week = $2`;

        try {
            const result = await db.query(sql, [doctorId, dayOfWeek]);
            return result || [];
        } catch (err) {
            logger.error(`SlotService: Failed to get doctor availability`, err);
            return [];
        }
    }

    /**
     * Get doctors for a department at a hospital.
     * 
     * @param {string} hospitalId - Hospital ID
     * @param {string} departmentName - Department name
     * @returns {Promise<Array>} Doctor records
     */
    static async getDoctorsForDepartment(hospitalId, departmentName) {
        const db = await initializeDatabase();

        const sql = `SELECT dv.id, dv.name, dv.hospital_id, d.name as department_name
               FROM doctors_v2 dv
               JOIN departments d ON dv.department_id = d.id
               WHERE dv.hospital_id = $1 AND d.name = $2 AND dv.is_active = true`;

        try {
            const result = await db.query(sql, [hospitalId, departmentName]);
            return result || [];
        } catch (err) {
            logger.error(`SlotService: Failed to get doctors for ${departmentName} at ${hospitalId}`, err);
            return [];
        }
    }

    /**
     * Get booked appointments for a doctor on a date.
     * 
     * @param {number} doctorId - Doctor ID
     * @param {string} date - Date (YYYY-MM-DD)
     * @returns {Promise<Set<string>>} Set of booked times (HH:MM)
     */
    static async getBookedSlots(doctorId, date) {
        const db = await initializeDatabase();

        const sql = `SELECT appointment_time FROM appointments 
               WHERE doctor_id = $1 
               AND date(appointment_time) = date($2)
               AND status IN ('pending', 'confirmed')`;

        try {
            const result = await db.query(sql, [doctorId, date]) || [];
            const bookedTimes = new Set();

            for (const row of result) {
                // Extract time from datetime
                const datetime = new Date(row.appointment_time);
                const timeStr = `${datetime.getHours().toString().padStart(2, '0')}:${datetime.getMinutes().toString().padStart(2, '0')}`;
                bookedTimes.add(timeStr);
            }

            return bookedTimes;
        } catch (err) {
            logger.error(`SlotService: Failed to get booked slots for doctor ${doctorId}`, err);
            return new Set();
        }
    }

    /**
     * Check if a slot is locked in Redis.
     * 
     * @param {string} hospitalId - Hospital ID
     * @param {number} doctorId - Doctor ID
     * @param {string} datetime - Slot datetime
     * @returns {Promise<string|null>} Session ID that owns the lock, or null
     */
    static async isSlotLocked(hospitalId, doctorId, datetime) {
        const key = getSlotLockKey(hospitalId, doctorId, datetime);
        try {
            return await redisClient.get(key);
        } catch (err) {
            logger.error(`SlotService: Failed to check slot lock`, err);
            return null;
        }
    }

    /**
     * Lock a slot for a session.
     * Uses SET NX (only if not exists) with TTL.
     * 
     * @param {string} hospitalId - Hospital ID
     * @param {number} doctorId - Doctor ID
     * @param {string} datetime - Slot datetime (ISO format)
     * @param {string} sessionId - Session ID claiming the lock
     * @returns {Promise<boolean>} True if lock acquired, false if already locked
     */
    static async lockSlot(hospitalId, doctorId, datetime, sessionId) {
        const key = getSlotLockKey(hospitalId, doctorId, datetime);

        try {
            // SET NX EX - Set only if Not eXists, with EXpiry
            const result = await redisClient.set(key, sessionId, 'NX', 'EX', SLOT_LOCK_TTL_SECONDS);

            if (result === 'OK') {
                logger.info(`SlotService: Slot locked - ${datetime} for doctor ${doctorId} at ${hospitalId} by session ${sessionId}`);
                return true;
            } else {
                logger.info(`SlotService: Slot already locked - ${datetime} for doctor ${doctorId}`);
                return false;
            }
        } catch (err) {
            logger.error(`SlotService: Failed to lock slot`, err);
            return false;
        }
    }

    /**
     * Unlock a slot atomically. Only the owner session can unlock.
     * 
     * PHASE 9: Uses Lua script for atomic check-and-delete.
     * This prevents race conditions between GET and DEL.
     * 
     * @param {string} hospitalId - Hospital ID
     * @param {number} doctorId - Doctor ID
     * @param {string} datetime - Slot datetime
     * @param {string} sessionId - Session ID that owns the lock
     * @returns {Promise<boolean>} True if unlocked, false otherwise
     */
    static async unlockSlot(hospitalId, doctorId, datetime, sessionId) {
        const key = getSlotLockKey(hospitalId, doctorId, datetime);

        try {
            // Lua script: atomically check owner and delete if match
            // KEYS[1] = lock key, ARGV[1] = expected session ID
            const UNLOCK_SCRIPT = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;

            // Check if redisClient supports eval (real Redis)
            if (typeof redisClient.eval === 'function') {
                const result = await redisClient.eval(UNLOCK_SCRIPT, 1, key, sessionId);

                if (result === 1) {
                    logger.info(`SlotService: Slot unlocked atomically - ${datetime} for doctor ${doctorId}`);
                    return true;
                } else {
                    logger.warn(`SlotService: Cannot unlock slot - not owner or already expired`);
                    return false;
                }
            } else {
                // Fallback for MockRedis (dev/test) - non-atomic but acceptable for testing
                const owner = await redisClient.get(key);
                if (owner === sessionId) {
                    await redisClient.del(key);
                    logger.info(`SlotService: Slot unlocked (fallback) - ${datetime} for doctor ${doctorId}`);
                    return true;
                }
                return false;
            }
        } catch (err) {
            logger.error(`SlotService: Failed to unlock slot`, err);
            return false;
        }
    }

    /**
     * Verify that a session still owns a slot lock.
     * 
     * PHASE 9: Used for double-checking before DB insert.
     * 
     * @param {string} hospitalId - Hospital ID
     * @param {number} doctorId - Doctor ID
     * @param {string} datetime - Slot datetime
     * @param {string} sessionId - Session ID to verify
     * @returns {Promise<boolean>} True if session owns the lock
     */
    static async verifyLock(hospitalId, doctorId, datetime, sessionId) {
        const key = getSlotLockKey(hospitalId, doctorId, datetime);

        try {
            const owner = await redisClient.get(key);
            const owns = owner === sessionId;

            if (!owns) {
                logger.warn(`SlotService: Lock verification failed - expected ${sessionId}, got ${owner}`);
            }

            return owns;
        } catch (err) {
            logger.error(`SlotService: Failed to verify lock`, err);
            return false;
        }
    }

    /**
     * Get available slots for a department on a specific date.
     * 
     * This is the main method - dynamically generates slots from doctor availability,
     * then filters out booked and locked slots.
     * 
     * @param {string} hospitalId - Hospital ID
     * @param {string} departmentName - Department name
     * @param {string} date - Date (YYYY-MM-DD)
     * @param {number} slotDurationMinutes - Slot duration (default 15)
     * @returns {Promise<Array>} Available slots with doctor info
     */
    static async getAvailableSlots(hospitalId, departmentName, date, slotDurationMinutes = DEFAULT_SLOT_DURATION_MINUTES) {
        logger.info(`SlotService: Getting available slots for ${departmentName} at ${hospitalId} on ${date}`);

        // 1. Get doctors for this department
        const doctors = await this.getDoctorsForDepartment(hospitalId, departmentName);

        if (doctors.length === 0) {
            logger.warn(`SlotService: No doctors found for ${departmentName} at ${hospitalId}`);
            return [];
        }

        // 2. Get day of week for the requested date
        const requestedDate = new Date(date);
        const dayOfWeek = getDayOfWeek(requestedDate);

        // 3. Current time (for filtering past slots)
        const now = new Date();
        const isToday = requestedDate.toDateString() === now.toDateString();
        const currentMinutes = isToday ? (now.getHours() * 60 + now.getMinutes()) : 0;

        const availableSlots = [];

        // 4. For each doctor, generate their slots
        for (const doctor of doctors) {
            // Get availability for this day
            const availabilities = await this.getDoctorAvailability(doctor.id, dayOfWeek);

            if (availabilities.length === 0) continue;

            // Get booked slots
            const bookedSlots = await this.getBookedSlots(doctor.id, date);

            // Generate slots for each availability window
            for (const avail of availabilities) {
                const startTime = avail.start_time;
                const endTime = avail.end_time;

                const slots = this.generateSlotsFromWindow(startTime, endTime, slotDurationMinutes);

                for (const slotTime of slots) {
                    // Skip if in the past (for today)
                    const slotMinutes = parseTimeToMinutes(slotTime);
                    if (isToday && slotMinutes <= currentMinutes) continue;

                    // Skip if already booked
                    if (bookedSlots.has(slotTime)) continue;

                    // Check if locked in Redis
                    const datetime = `${date}T${slotTime}:00`;
                    const lockedBy = await this.isSlotLocked(hospitalId, doctor.id, datetime);
                    if (lockedBy) continue;

                    // Slot is available
                    availableSlots.push({
                        doctor_id: doctor.id,
                        doctor_name: doctor.name,
                        department: departmentName,
                        date: date,
                        time: slotTime,
                        datetime: datetime,
                        duration_minutes: slotDurationMinutes
                    });
                }
            }
        }

        // Sort by time, then doctor
        availableSlots.sort((a, b) => {
            if (a.time !== b.time) return a.time.localeCompare(b.time);
            return a.doctor_name.localeCompare(b.doctor_name);
        });

        logger.info(`SlotService: Found ${availableSlots.length} available slots for ${departmentName}`);
        return availableSlots;
    }

    /**
     * Find a specific slot by time.
     * 
     * @param {string} hospitalId - Hospital ID
     * @param {string} departmentName - Department name
     * @param {string} date - Date (YYYY-MM-DD)
     * @param {string} time - Time (HH:MM)
     * @returns {Promise<Object|null>} Slot object or null
     */
    static async findSlot(hospitalId, departmentName, date, time) {
        const slots = await this.getAvailableSlots(hospitalId, departmentName, date);
        return slots.find(s => s.time === time) || null;
    }
}

module.exports = SlotService;
