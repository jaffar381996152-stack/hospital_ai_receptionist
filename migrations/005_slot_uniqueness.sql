-- Migration 005: Phase 9 - Slot Uniqueness Constraint
--
-- Defense-in-depth: Prevent double booking at database level.
-- This partial unique index only considers active appointments.
--
-- Rollback: DROP INDEX IF EXISTS idx_unique_active_slot;

-- PostgreSQL: Unique partial index on active appointments only
-- Ensures same doctor can't have two active appointments at same time
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_slot
ON appointments (hospital_id, doctor_id, appointment_time)
WHERE status NOT IN ('cancelled', 'no_show');

-- Comment: This is a defense-in-depth measure.
-- Primary protection is Redis-based slot locking.
-- This constraint catches any edge cases that slip through.
