/**
 * Booking State Machine - Phase 4
 * 
 * Manages booking lifecycle with valid state transitions.
 * 
 * States:
 *   INITIATED     - Booking created, patient info captured
 *   AWAITING_OTP  - OTP sent, waiting for verification
 *   CONFIRMED     - OTP verified, booking confirmed
 *   CHECKED_IN    - Patient arrived for appointment
 *   CANCELLED     - Booking cancelled by user/system
 *   EXPIRED       - OTP timeout, booking expired
 * 
 * Invalid transitions throw errors.
 */

const redisClient = require('../config/redis');
const { logger, auditLogger } = require('../config/logger');

// Booking states
const BOOKING_STATES = {
    INITIATED: 'INITIATED',
    AWAITING_OTP: 'AWAITING_OTP',
    CONFIRMED: 'CONFIRMED',
    CHECKED_IN: 'CHECKED_IN',
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED'
};

// Valid transitions: { fromState: [validToStates] }
const VALID_TRANSITIONS = {
    [BOOKING_STATES.INITIATED]: [
        BOOKING_STATES.AWAITING_OTP,
        BOOKING_STATES.CANCELLED
    ],
    [BOOKING_STATES.AWAITING_OTP]: [
        BOOKING_STATES.CONFIRMED,
        BOOKING_STATES.EXPIRED,
        BOOKING_STATES.CANCELLED
    ],
    [BOOKING_STATES.CONFIRMED]: [
        BOOKING_STATES.CHECKED_IN,
        BOOKING_STATES.CANCELLED
    ],
    [BOOKING_STATES.CHECKED_IN]: [],  // Terminal state
    [BOOKING_STATES.CANCELLED]: [],   // Terminal state
    [BOOKING_STATES.EXPIRED]: []      // Terminal state
};

// Redis key prefix for booking drafts
const BOOKING_DRAFT_PREFIX = 'booking:draft:';
const BOOKING_DRAFT_TTL = 600; // 10 minutes

/**
 * Generate a unique booking ID.
 * @returns {string} Unique ID
 */
function generateBookingId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `BK${timestamp}${random}`.toUpperCase();
}

/**
 * Get Redis key for a booking draft.
 * @param {string} bookingId - Booking ID
 * @returns {string} Redis key
 */
function getBookingDraftKey(bookingId) {
    return `${BOOKING_DRAFT_PREFIX}${bookingId}`;
}

class BookingStateMachine {

    /**
     * Check if a state transition is valid.
     * 
     * @param {string} fromState - Current state
     * @param {string} toState - Target state
     * @returns {boolean} True if valid
     */
    static isValidTransition(fromState, toState) {
        const validNextStates = VALID_TRANSITIONS[fromState] || [];
        return validNextStates.includes(toState);
    }

    /**
     * Create a new booking in INITIATED state.
     * Stores booking data in Redis (not DB) until confirmed.
     * 
     * @param {Object} bookingData - Booking details
     * @param {string} bookingData.hospitalId - Hospital ID
     * @param {number} bookingData.doctorId - Doctor ID
     * @param {string} bookingData.datetime - Appointment datetime
     * @param {string} bookingData.patientName - Patient name
     * @param {string} bookingData.patientPhone - Patient phone
     * @param {string} bookingData.patientEmail - Patient email (optional)
     * @param {string} sessionId - Session ID
     * @returns {Promise<Object>} Booking draft with ID and state
     */
    static async createBooking(bookingData, sessionId) {
        const bookingId = generateBookingId();

        const booking = {
            id: bookingId,
            ...bookingData,
            state: BOOKING_STATES.INITIATED,
            sessionId: sessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Store in Redis (not in DB until confirmed)
        const key = getBookingDraftKey(bookingId);
        await redisClient.set(key, JSON.stringify(booking), 'EX', BOOKING_DRAFT_TTL);

        logger.info(`BookingStateMachine: Created booking ${bookingId} in INITIATED state`);

        auditLogger.info({
            action: 'BOOKING_CREATED',
            hospital_id: bookingData.hospitalId,
            actor: sessionId,
            data: {
                booking_id: bookingId,
                state: BOOKING_STATES.INITIATED,
                doctor_id: bookingData.doctorId,
                datetime: bookingData.datetime
            }
        });

        return booking;
    }

    /**
     * Get booking draft from Redis.
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<Object|null>} Booking or null
     */
    static async getBooking(bookingId) {
        const key = getBookingDraftKey(bookingId);
        const data = await redisClient.get(key);

        if (!data) return null;

        return JSON.parse(data);
    }

    /**
     * Transition booking to new state.
     * Validates transition before applying.
     * 
     * @param {string} bookingId - Booking ID
     * @param {string} newState - Target state
     * @param {Object} updates - Additional fields to update
     * @returns {Promise<Object>} Updated booking
     * @throws {Error} If transition is invalid
     */
    static async transition(bookingId, newState, updates = {}) {
        const booking = await this.getBooking(bookingId);

        if (!booking) {
            throw new Error(`Booking not found: ${bookingId}`);
        }

        const currentState = booking.state;

        // Validate transition
        if (!this.isValidTransition(currentState, newState)) {
            logger.error(`BookingStateMachine: Invalid transition ${currentState} → ${newState} for ${bookingId}`);

            auditLogger.info({
                action: 'BOOKING_INVALID_TRANSITION',
                hospital_id: booking.hospitalId,
                actor: 'system',
                data: {
                    booking_id: bookingId,
                    from_state: currentState,
                    to_state: newState
                }
            });

            throw new Error(`Invalid state transition: ${currentState} → ${newState}`);
        }

        // Apply transition
        const updatedBooking = {
            ...booking,
            ...updates,
            state: newState,
            updatedAt: new Date().toISOString(),
            previousState: currentState
        };

        // Update in Redis
        const key = getBookingDraftKey(bookingId);
        await redisClient.set(key, JSON.stringify(updatedBooking), 'EX', BOOKING_DRAFT_TTL);

        logger.info(`BookingStateMachine: Transitioned ${bookingId}: ${currentState} → ${newState}`);

        auditLogger.info({
            action: 'BOOKING_STATE_CHANGED',
            hospital_id: booking.hospitalId,
            actor: 'system',
            data: {
                booking_id: bookingId,
                from_state: currentState,
                to_state: newState
            }
        });

        return updatedBooking;
    }

    /**
     * Transition to AWAITING_OTP state.
     * Called when OTP is sent.
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<Object>} Updated booking
     */
    static async sendOtp(bookingId) {
        return this.transition(bookingId, BOOKING_STATES.AWAITING_OTP, {
            otpSentAt: new Date().toISOString()
        });
    }

    /**
     * Transition to CONFIRMED state.
     * Called when OTP is verified.
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<Object>} Updated booking
     */
    static async confirm(bookingId) {
        return this.transition(bookingId, BOOKING_STATES.CONFIRMED, {
            confirmedAt: new Date().toISOString()
        });
    }

    /**
     * Transition to CHECKED_IN state.
     * Called when patient arrives.
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<Object>} Updated booking
     */
    static async checkIn(bookingId) {
        return this.transition(bookingId, BOOKING_STATES.CHECKED_IN, {
            checkedInAt: new Date().toISOString()
        });
    }

    /**
     * Transition to CANCELLED state.
     * 
     * @param {string} bookingId - Booking ID
     * @param {string} reason - Cancellation reason
     * @returns {Promise<Object>} Updated booking
     */
    static async cancel(bookingId, reason = 'User cancelled') {
        return this.transition(bookingId, BOOKING_STATES.CANCELLED, {
            cancelledAt: new Date().toISOString(),
            cancellationReason: reason
        });
    }

    /**
     * Transition to EXPIRED state.
     * Called when OTP times out.
     * 
     * @param {string} bookingId - Booking ID
     * @returns {Promise<Object>} Updated booking
     */
    static async expire(bookingId) {
        return this.transition(bookingId, BOOKING_STATES.EXPIRED, {
            expiredAt: new Date().toISOString()
        });
    }

    /**
     * Delete booking draft from Redis.
     * Used after confirming (moved to DB) or expiring.
     * 
     * @param {string} bookingId - Booking ID
     */
    static async deleteDraft(bookingId) {
        const key = getBookingDraftKey(bookingId);
        await redisClient.del(key);
        logger.info(`BookingStateMachine: Deleted draft ${bookingId}`);
    }

    /**
     * Check if booking is in a terminal state.
     * 
     * @param {string} state - Booking state
     * @returns {boolean} True if terminal
     */
    static isTerminalState(state) {
        return [
            BOOKING_STATES.CHECKED_IN,
            BOOKING_STATES.CANCELLED,
            BOOKING_STATES.EXPIRED
        ].includes(state);
    }
}

module.exports = {
    BookingStateMachine,
    BOOKING_STATES,
    VALID_TRANSITIONS,
    generateBookingId
};
