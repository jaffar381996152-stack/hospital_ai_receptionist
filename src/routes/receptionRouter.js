/**
 * Reception Router - Phase 6/8
 * 
 * API endpoints for reception dashboard.
 * 
 * Routes:
 * - POST /login - Authenticate staff user
 * - POST /logout - Destroy session
 * - GET /me - Get current user info
 * - GET /departments - List departments
 * - GET /doctors - List doctors (filterable by department)
 * - GET /bookings - Search bookings (role-aware)
 * - POST /checkin - Check-in a booking (reception only)
 * 
 * SECURITY:
 * - All routes (except login/logout) require authentication
 * - Hospital isolation enforced via middleware
 * - Role-based access control (Phase 8)
 * - Rate limiting on login endpoint
 */

const express = require('express');
const router = express.Router();

const ReceptionAuthService = require('../services/receptionAuthService');
const { requireReceptionAuth, requireReceptionOnly, loginRateLimiter } = require('../middleware/receptionAuth');
const { initializeDatabase } = require('../config/productionDb');
const { AuditService } = require('../services/auditService');
const { logger } = require('../config/logger');
// ...



// ============================================================
// PUBLIC ROUTES (no auth required)
// ============================================================

/**
 * POST /login
 * Authenticate a reception staff member.
 */
router.post('/login', loginRateLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const hospitalId = req.hospitalId;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const result = await ReceptionAuthService.login(hospitalId, username, password);

        if (!result.success) {
            return res.status(401).json({ error: result.error });
        }

        // Store user in session
        req.session.receptionUser = result.user;

        res.json({
            success: true,
            user: {
                id: result.user.id,
                username: result.user.username,
                role: result.user.role,
                hospitalId: result.user.hospitalId,
                doctorId: result.user.doctorId || null
            }
        });

    } catch (err) {
        logger.error('Reception login error', err);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

/**
 * POST /logout
 * Destroy the session.
 */
router.post('/logout', async (req, res) => {
    const user = req.session?.receptionUser;

    if (user) {
        // Audit log
        await AuditService.logStaffLogout(user.hospitalId, user.username);
    }

    req.session.destroy((err) => {
        if (err) {
            logger.error('Session destroy error', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie('connect.sid'); // Explicitly clear cookie
        res.json({ success: true });
    });
});

/**
 * GET /session
 * Check current session status.
 */
router.get('/session', (req, res) => {
    const user = req.session?.receptionUser;

    if (!user) {
        return res.status(401).json({ authenticated: false });
    }

    // Verify hospital matches
    if (user.hospitalId !== req.hospitalId) {
        return res.status(401).json({ authenticated: false });
    }

    res.json({
        authenticated: true,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            hospitalId: user.hospitalId,
            doctorId: user.doctorId || null
        }
    });
});

// ============================================================
// PROTECTED ROUTES (auth required)
// ============================================================

// Apply authentication to all routes below
router.use(requireReceptionAuth);

/**
 * GET /me
 * Get current authenticated user info.
 */
router.get('/me', (req, res) => {
    res.json({
        user: {
            id: req.receptionUser.id,
            username: req.receptionUser.username,
            role: req.receptionUser.role,
            hospitalId: req.receptionUser.hospitalId,
            doctorId: req.receptionUser.doctorId || null
        }
    });
});

/**
 * GET /departments
 * List departments for the hospital.
 */
router.get('/departments', async (req, res) => {
    try {
        const hospitalId = req.hospitalId;
        const db = await initializeDatabase();

        const sql = `SELECT id, name FROM departments WHERE hospital_id = $1 ORDER BY name ASC`;

        const rows = await db.query(sql, [hospitalId]);

        res.json({ departments: rows || [] });

    } catch (err) {
        logger.error('Reception departments error', err);
        res.status(500).json({ error: 'Failed to load departments' });
    }
});

/**
 * GET /doctors
 * List doctors for the hospital.
 * Query params:
 * - department_id: Filter by department
 */
router.get('/doctors', async (req, res) => {
    try {
        const hospitalId = req.hospitalId;
        const { department_id } = req.query;

        const db = await initializeDatabase();

        let sql, params;

        if (department_id) {
            sql = `SELECT id, name, department_id FROM doctors_v2 
                   WHERE hospital_id = $1 AND department_id = $2 ORDER BY name ASC`;
            params = [hospitalId, parseInt(department_id)];
        } else {
            sql = `SELECT id, name, department_id FROM doctors_v2 
                   WHERE hospital_id = $1 ORDER BY name ASC`;
            params = [hospitalId];
        }

        const rows = await db.query(sql, params);

        res.json({ doctors: rows || [] });

    } catch (err) {
        logger.error('Reception doctors error', err);
        res.status(500).json({ error: 'Failed to load doctors' });
    }
});

/**
 * GET /bookings
 * Search for bookings.
 * 
 * Query params:
 * - booking_id: Exact booking ID
 * - phone: Last 4 digits of phone
 * - date: Date filter (YYYY-MM-DD), defaults to today
 * - department_id: Filter by department
 * - doctor_id: Filter by doctor
 * - status: Filter by status
 * 
 * ROLE-BASED:
 * - reception/admin: See all hospital bookings
 * - doctor: See only own bookings
 */
router.get('/bookings', async (req, res) => {
    try {
        const hospitalId = req.hospitalId;
        const userRole = req.receptionUser.role;
        const userDoctorId = req.receptionUser.doctorId;

        const { booking_id, phone, date, department_id, doctor_id, status } = req.query;

        const db = await initializeDatabase();

        // Default to today
        const searchDate = date || new Date().toISOString().split('T')[0];

        // Build query dynamically
        let conditions = [];
        let params = [];
        let paramIndex = 1;

        // Always filter by hospital
        conditions.push(`a.hospital_id = $${paramIndex++}`);
        params.push(hospitalId);

        // ROLE-BASED: Doctor can only see own bookings
        if (userRole === 'doctor' && userDoctorId) {
            conditions.push(`a.doctor_id = $${paramIndex++}`);
            params.push(userDoctorId);
        } else if (doctor_id) {
            // Optional doctor filter for reception
            conditions.push(`a.doctor_id = $${paramIndex++}`);
            params.push(parseInt(doctor_id));
        }

        // Booking ID (exact match)
        if (booking_id) {
            conditions.push(`a.id = $${paramIndex++}`);
            params.push(parseInt(booking_id));
        } else {
            // Date filter (default)
            conditions.push(`DATE(a.appointment_time) = $${paramIndex++}`);
            params.push(searchDate);
        }

        // Department filter
        if (department_id) {
            conditions.push(`d.department_id = $${paramIndex++}`);
            params.push(parseInt(department_id));
        }

        // Status filter
        if (status) {
            conditions.push(`a.status = $${paramIndex++}`);
            params.push(status);
        }

        const whereClause = conditions.join(' AND ');

        const sql = `
            SELECT a.id, a.hospital_id, a.doctor_id, a.appointment_time, a.status,
                   a.patient_name_encrypted, a.patient_phone_encrypted,
                   a.checked_in_at, a.checked_in_by,
                   d.name as doctor_name, d.department_id,
                   dep.name as department_name
            FROM appointments a
            LEFT JOIN doctors_v2 d ON a.doctor_id = d.id
            LEFT JOIN departments dep ON d.department_id = dep.id
            WHERE ${whereClause}
            ORDER BY a.appointment_time ASC
        `;

        const rows = await db.query(sql, params);

        // Decrypt and format results
        const bookings = (rows || []).map(row => {
            const decryptedPhone = decrypt(row.patient_phone_encrypted);
            const decryptedName = decrypt(row.patient_name_encrypted);

            return {
                id: row.id,
                patientName: decryptedName,
                patientPhoneLast4: decryptedPhone ? decryptedPhone.slice(-4) : '****',
                doctorId: row.doctor_id,
                doctorName: row.doctor_name || 'Unknown',
                departmentId: row.department_id,
                departmentName: row.department_name || 'Unknown',
                appointmentTime: row.appointment_time,
                status: row.status,
                checkedInAt: row.checked_in_at,
                checkedInBy: row.checked_in_by
            };
        });

        // Filter by phone if provided (post-query due to encryption)
        let filteredBookings = bookings;
        if (phone) {
            const phoneLast4 = phone.slice(-4);
            filteredBookings = bookings.filter(b => b.patientPhoneLast4 === phoneLast4);
        }

        auditLogger.info({
            action: 'RECEPTION_SEARCH',
            hospital_id: hospitalId,
            actor: req.receptionUser.username,
            data: {
                search_date: searchDate,
                filters: { booking_id, department_id, doctor_id, status },
                results_count: filteredBookings.length,
                role_restricted: userRole === 'doctor'
            }
        });

        res.json({
            bookings: filteredBookings,
            meta: {
                total: filteredBookings.length,
                date: searchDate,
                userRole: userRole
            }
        });

    } catch (err) {
        logger.error('Reception bookings search error', err);
        res.status(500).json({ error: 'Failed to search bookings' });
    }
});

/**
 * POST /checkin
 * Check-in a confirmed booking.
 * 
 * ROLE: Reception/Admin only. Doctors cannot check-in.
 */
router.post('/checkin', requireReceptionOnly, async (req, res) => {
    try {
        const { booking_id } = req.body;
        const hospitalId = req.hospitalId;
        const staffUsername = req.receptionUser.username;

        if (!booking_id) {
            return res.status(400).json({ error: 'booking_id is required' });
        }

        const db = await initializeDatabase();

        // Get current booking state
        const selectSql = `SELECT id, hospital_id, status, checked_in_at FROM appointments WHERE id = $1 AND hospital_id = $2`;

        const booking = await db.get(selectSql, [parseInt(booking_id), hospitalId]);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // RULE: Only CONFIRMED bookings can be checked in
        if (booking.status !== 'confirmed') {
            logger.warn(`Reception: Check-in rejected - booking ${booking_id} status is ${booking.status}`);
            return res.status(400).json({
                error: `Cannot check in booking with status "${booking.status}". Only confirmed bookings can be checked in.`
            });
        }

        // RULE: Prevent duplicate check-in
        if (booking.checked_in_at) {
            return res.status(400).json({
                error: 'Booking has already been checked in',
                checked_in_at: booking.checked_in_at,
                checked_in_by: booking.checked_in_by
            });
        }

        // Update booking status
        const updateSql = `UPDATE appointments 
               SET status = 'checked_in', checked_in_at = NOW(), checked_in_by = $1
               WHERE id = $2 AND hospital_id = $3`;

        await db.execute(updateSql, [staffUsername, parseInt(booking_id), hospitalId]);

        // Audit log
        // Audit log
        await AuditService.logPatientCheckedIn(hospitalId, booking_id, staffUsername);

        logger.info(`Reception: Booking ${booking_id} checked in by ${staffUsername} at hospital ${hospitalId}`);

        res.json({
            success: true,
            booking_id: booking_id,
            status: 'checked_in',
            checked_in_by: staffUsername
        });

    } catch (err) {
        logger.error('Reception check-in error', err);
        res.status(500).json({ error: 'Check-in failed. Please try again.' });
    }
});

module.exports = router;
