-- Migration 004: Phase 8 - Doctor Role Support
--
-- Adds doctor_id column to staff_users for linking doctor users
-- to their doctors_v2 record for role-based access control.
-- Also adds 'doctor' to the allowed roles.
--
-- Rollback: ALTER TABLE staff_users DROP COLUMN doctor_id; 
--           (and recreate role constraint without 'doctor')

-- Add doctor_id column
ALTER TABLE staff_users ADD COLUMN doctor_id INTEGER;

-- Add foreign key constraint (Skipped for SQLite compatibility)
-- ALTER TABLE staff_users 
-- ADD CONSTRAINT fk_staff_doctor 
-- FOREIGN KEY (doctor_id) REFERENCES doctors_v2(id) ON DELETE SET NULL;

-- Drop the old role constraint and add new one with 'doctor' (Skipped for SQLite)
-- ALTER TABLE staff_users DROP CONSTRAINT IF EXISTS staff_users_role_check;
-- ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_check 
-- CHECK (role IN ('receptionist', 'admin', 'manager', 'doctor'));

-- Index for doctor_id lookups
CREATE INDEX IF NOT EXISTS idx_staff_users_doctor ON staff_users(doctor_id);
