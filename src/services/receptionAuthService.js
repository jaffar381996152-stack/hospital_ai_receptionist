/**
 * Reception Auth Service - Phase 6
 * 
 * Handles authentication for reception dashboard users.
 * 
 * Features:
 * - Password hashing using scrypt (crypto-based, no external deps)
 * - Session-based login
 * - Hospital-scoped user lookup
 * 
 * SECURITY:
 * - Passwords stored as salt:hash (64-byte salt, 64-byte hash)
 * - Timing-safe comparison for password verification
 * - Rate limiting handled at middleware level
 */

const crypto = require('crypto');
const { initializeDatabase } = require('../config/productionDb');
const { AuditService } = require('./auditService');
const { logger } = require('../config/logger');
// ...



// Scrypt parameters (OWASP recommended)
const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
    N: 16384,  // CPU/memory cost
    r: 8,      // Block size
    p: 1       // Parallelization
};

class ReceptionAuthService {

    /**
     * Hash a password using scrypt.
     * 
     * @param {string} password - Plain text password
     * @returns {Promise<string>} Hash in format "salt:hash" (both hex encoded)
     */
    static async hashPassword(password) {
        return new Promise((resolve, reject) => {
            const salt = crypto.randomBytes(SALT_LENGTH);

            crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (err, derivedKey) => {
                if (err) {
                    logger.error('ReceptionAuth: Password hashing failed', err);
                    reject(err);
                    return;
                }

                const hash = salt.toString('hex') + ':' + derivedKey.toString('hex');
                resolve(hash);
            });
        });
    }

    /**
     * Verify a password against a stored hash.
     * 
     * @param {string} password - Plain text password to verify
     * @param {string} storedHash - Hash from database (salt:hash format)
     * @returns {Promise<boolean>} True if password matches
     */
    static async verifyPassword(password, storedHash) {
        return new Promise((resolve, reject) => {
            if (!storedHash || !storedHash.includes(':')) {
                resolve(false);
                return;
            }

            const [saltHex, hashHex] = storedHash.split(':');
            const salt = Buffer.from(saltHex, 'hex');
            const storedKey = Buffer.from(hashHex, 'hex');

            crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (err, derivedKey) => {
                if (err) {
                    logger.error('ReceptionAuth: Password verification failed', err);
                    reject(err);
                    return;
                }

                // Timing-safe comparison to prevent timing attacks
                const match = crypto.timingSafeEqual(derivedKey, storedKey);
                resolve(match);
            });
        });
    }

    /**
     * Authenticate a reception user.
     * 
     * @param {string} hospitalId - Hospital ID (for scoping)
     * @param {string} username - Username
     * @param {string} password - Plain text password
     * @returns {Promise<Object>} { success, user?, error? }
     */
    static async login(hospitalId, username, password) {
        try {
            const db = await initializeDatabase();

            // Find user by hospital_id + username (Phase 8: include doctor_id)
            const sql = `SELECT id, hospital_id, username, password_hash, role, is_active, doctor_id 
                   FROM staff_users 
                   WHERE hospital_id = $1 AND username = $2`;

            const user = await db.get(sql, [hospitalId, username]);

            if (!user) {
                logger.warn(`ReceptionAuth: Login failed - user not found: ${username}@${hospitalId}`);
                return { success: false, error: 'Invalid username or password' };
            }

            if (!user.is_active) {
                logger.warn(`ReceptionAuth: Login failed - user inactive: ${username}@${hospitalId}`);
                return { success: false, error: 'Account is disabled' };
            }

            // Verify password
            const passwordValid = await this.verifyPassword(password, user.password_hash);

            if (!passwordValid) {
                logger.warn(`ReceptionAuth: Login failed - wrong password: ${username}@${hospitalId}`);
                return { success: false, error: 'Invalid username or password' };
            }

            // Update last_login
            const updateSql = `UPDATE staff_users SET last_login = NOW() WHERE id = $1`;

            await db.execute(updateSql, [user.id]);

            // Audit log
            await AuditService.logStaffLogin(hospitalId, username);

            logger.info(`ReceptionAuth: Login successful: ${username}@${hospitalId} (role: ${user.role})`);

            return {
                success: true,
                user: {
                    id: user.id,
                    hospitalId: user.hospital_id,
                    username: user.username,
                    role: user.role,
                    doctorId: user.doctor_id || null
                }
            };

        } catch (err) {
            logger.error('ReceptionAuth: Login error', err);
            return { success: false, error: `Authentication failed: ${err.message}` };
        }
    }

    /**
     * Create a new reception user.
     * 
     * @param {Object} userData - User data
     * @param {string} userData.hospitalId - Hospital ID
     * @param {string} userData.username - Username
     * @param {string} userData.password - Plain text password
     * @param {string} userData.role - Role (receptionist, admin, manager)
     * @returns {Promise<Object>} { success, userId?, error? }
     */
    static async createUser({ hospitalId, username, password, role = 'receptionist' }) {
        try {
            const db = await initializeDatabase();

            // Hash the password
            const passwordHash = await this.hashPassword(password);

            const sql = `INSERT INTO staff_users (hospital_id, username, password_hash, role) 
                   VALUES ($1, $2, $3, $4) RETURNING id`;

            const result = await db.execute(sql, [hospitalId, username, passwordHash, role]);

            const userId = result.rows?.[0]?.id;

            await AuditService.log({
                hospitalId,
                entityType: 'staff',
                entityId: userId.toString(),
                action: 'RECEPTION_USER_CREATED',
                performedBy: 'system',
                metadata: { username, role }
            });

            logger.info(`ReceptionAuth: User created: ${username}@${hospitalId}`);

            return { success: true, userId };

        } catch (err) {
            if (err.message?.includes('UNIQUE') || err.code === '23505') {
                return { success: false, error: 'Username already exists for this hospital' };
            }
            logger.error('ReceptionAuth: User creation failed', err);
            return { success: false, error: 'Failed to create user' };
        }
    }

    /**
     * Change user password.
     * 
     * @param {number} userId - User ID
     * @param {string} newPassword - New plain text password
     * @returns {Promise<boolean>} Success
     */
    static async changePassword(userId, newPassword) {
        try {
            const db = await initializeDatabase();

            const passwordHash = await this.hashPassword(newPassword);

            const sql = `UPDATE staff_users SET password_hash = $1 WHERE id = $2`;

            await db.execute(sql, [passwordHash, userId]);

            await AuditService.log({
                hospitalId: 'unknown', // Need to pass hospitalId ideally, but system action
                entityType: 'staff',
                entityId: userId.toString(),
                action: 'RECEPTION_PASSWORD_CHANGED',
                performedBy: 'system',
                metadata: { user_id: userId }
            });

            return true;
        } catch (err) {
            logger.error('ReceptionAuth: Password change failed', err);
            return false;
        }
    }
}

module.exports = ReceptionAuthService;
