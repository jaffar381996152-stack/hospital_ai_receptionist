/**
 * Booking Flow Verification Test
 * 
 * Tests the complete booking flow:
 * 1. Get available slots
 * 2. Initiate booking (lock slot)
 * 3. Request OTP
 * 4. Confirm with OTP
 * 5. Verify booking in database
 */

const { BookingService } = require('../services/bookingService');
const SlotService = require('../services/slotService');
const { initializeDatabase } = require('../config/productionDb');
const { logger } = require('../config/logger');

async function testBookingFlow() {
    console.log('\n=== Booking Flow Verification Test ===\n');

    const hospitalId = 'default';
    const department = 'Cardiology';
    const today = new Date().toISOString().split('T')[0];
    const sessionId = `test-session-${Date.now()}`;

    try {
        // Step 1: Get available slots
        console.log('Step 1: Fetching available slots...');
        const slots = await BookingService.getAvailableSlots(department, hospitalId, today);

        if (slots.length === 0) {
            console.log('❌ No available slots found. Cannot proceed with test.');
            console.log('   This could mean:');
            console.log('   - No doctors in Cardiology department');
            console.log('   - No doctor availability configured');
            console.log('   - All slots are booked');
            return false;
        }

        console.log(`✅ Found ${slots.length} available slots`);
        console.log(`   First slot: ${slots[0].time} with Dr. ${slots[0].doctor_name}`);

        // Step 2: Initiate booking
        console.log('\nStep 2: Initiating booking...');
        const firstSlot = slots[0];
        const bookingData = {
            hospitalId,
            doctorId: firstSlot.doctor_id,
            datetime: firstSlot.datetime,
            patientName: 'Test Patient',
            patientPhone: '+966501234567',
            patientEmail: 'test@example.com'
        };

        const initiateResult = await BookingService.initiateBooking(bookingData, sessionId);

        if (!initiateResult.success) {
            console.log(`❌ Failed to initiate booking: ${initiateResult.error}`);
            return false;
        }

        console.log(`✅ Booking initiated: ${initiateResult.booking.id}`);
        const bookingId = initiateResult.booking.id;

        // Step 3: Verify slot is locked
        console.log('\nStep 3: Verifying slot lock...');
        const isLocked = await SlotService.isSlotLocked(hospitalId, firstSlot.doctor_id, firstSlot.datetime);

        if (!isLocked) {
            console.log('❌ Slot is not locked after initiation');
            return false;
        }

        console.log(`✅ Slot is locked by session: ${isLocked}`);

        // Step 4: Request OTP
        console.log('\nStep 4: Requesting OTP...');
        const otpResult = await BookingService.requestOtpForBooking(bookingId);

        if (!otpResult.success) {
            console.log(`❌ Failed to request OTP: ${otpResult.error}`);
            return false;
        }

        console.log(`✅ OTP generated: ${otpResult.otp}`);
        const otpCode = otpResult.otp;

        // Step 5: Confirm booking with OTP
        console.log('\nStep 5: Confirming booking with OTP...');
        const hospital = { id: hospitalId, name: 'Test Hospital' };
        const confirmResult = await BookingService.confirmBookingWithOtp(bookingId, otpCode, hospital);

        if (!confirmResult.success) {
            console.log(`❌ Failed to confirm booking: ${confirmResult.error}`);
            return false;
        }

        console.log(`✅ Booking confirmed: Appointment ID ${confirmResult.appointment.id}`);

        // Step 6: Verify in database
        console.log('\nStep 6: Verifying booking in database...');
        const appointment = await BookingService.getAppointment(confirmResult.appointment.id, hospitalId);

        if (!appointment) {
            console.log('❌ Appointment not found in database');
            return false;
        }

        console.log(`✅ Appointment verified in database:`);
        console.log(`   - Patient: ${appointment.patient_name}`);
        console.log(`   - Phone: ${appointment.patient_phone}`);
        console.log(`   - Time: ${appointment.appointment_time}`);
        console.log(`   - Status: ${appointment.status}`);

        // Step 7: Verify slot is unlocked
        console.log('\nStep 7: Verifying slot is unlocked...');
        const stillLocked = await SlotService.isSlotLocked(hospitalId, firstSlot.doctor_id, firstSlot.datetime);

        if (stillLocked) {
            console.log('⚠️  Slot is still locked (expected: unlocked after confirmation)');
        } else {
            console.log('✅ Slot is unlocked after confirmation');
        }

        // Step 8: Verify slot is no longer available
        console.log('\nStep 8: Verifying slot is no longer available...');
        const updatedSlots = await BookingService.getAvailableSlots(department, hospitalId, today);
        const slotStillAvailable = updatedSlots.find(s => s.datetime === firstSlot.datetime);

        if (slotStillAvailable) {
            console.log('❌ Booked slot is still showing as available');
            return false;
        }

        console.log('✅ Booked slot correctly removed from available slots');

        console.log('\n=== ✅ ALL TESTS PASSED ===\n');
        return true;

    } catch (error) {
        console.error('\n❌ Test failed with error:');
        console.error(error);
        return false;
    }
}

// Run the test
async function main() {
    try {
        // Initialize database connection
        await initializeDatabase();

        const success = await testBookingFlow();
        process.exit(success ? 0 : 1);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

main();
