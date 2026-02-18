-- ============================================================
-- ADD HOSPITAL DATA SCRIPT
-- ============================================================
-- Use this script to add new hospitals, departments, and doctors
-- to your PostgreSQL database.
--
-- HOW TO USE:
-- 1. Replace the placeholder values with your actual data.
-- 2. Run this script in your SQL client (e.g., pgAdmin, dbeaver) 
--    or via terminal: psql -d your_db_name -f add_hospital_data.sql
-- ============================================================

-- 1. Create a new Hospital
-- REPLACE 'new_hospital_id' with a unique ID (e.g., 'city_clinic', 'al_shifa_branch2')
-- REPLACE 'New Hospital Name' with the display name
INSERT INTO hospitals (hospital_id, name, timezone, contact_email)
VALUES 
    ('city_clinic', 'City Clinic', 'Asia/Riyadh', 'contact@cityclinic.com')
ON CONFLICT (hospital_id) DO NOTHING; -- Prevents error if already exists

-- 2. Add Departments for this Hospital
-- Note: 'city_clinic' must match the hospital_id above
INSERT INTO departments (hospital_id, name)
VALUES 
    ('city_clinic', 'General Medicine'),
    ('city_clinic', 'Pediatrics'),
    ('city_clinic', 'Dermatology')
ON CONFLICT (hospital_id, name) DO NOTHING;

-- 3. Add Doctors
-- We need to fetch the department IDs first. In a raw script, we insert by looking up the ID.
-- MODIFY the doctor names and departments as needed.

-- Dr. Sarah (General Medicine)
INSERT INTO doctors_v2 (hospital_id, department_id, name, is_active)
SELECT 'city_clinic', id, 'Dr. Sarah Ahmed', true
FROM departments 
WHERE hospital_id = 'city_clinic' AND name = 'General Medicine';

-- Dr. John (Pediatrics)
INSERT INTO doctors_v2 (hospital_id, department_id, name, is_active)
SELECT 'city_clinic', id, 'Dr. John Doe', true
FROM departments 
WHERE hospital_id = 'city_clinic' AND name = 'Pediatrics';

-- 4. Add Doctor Working Hours (Availability)
-- Day of week: 0=Sunday, 1=Monday, ..., 6=Saturday
-- Time format: HH:MM:SS (24-hour format)

-- Add hours for Dr. Sarah (assuming she is the most recent doctor added for General Medicine)
-- This subquery strategy is a bit complex for a simple script, so here is a more direct way 
-- if you know the doctor's ID. Since we don't know the ID yet, we look it up by name.

INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time)
SELECT id, 0, '09:00:00', '17:00:00' -- Sunday
FROM doctors_v2 WHERE name = 'Dr. Sarah Ahmed' AND hospital_id = 'city_clinic';

INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time)
SELECT id, 1, '09:00:00', '17:00:00' -- Monday
FROM doctors_v2 WHERE name = 'Dr. Sarah Ahmed' AND hospital_id = 'city_clinic';

INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time)
SELECT id, 2, '09:00:00', '17:00:00' -- Tuesday
FROM doctors_v2 WHERE name = 'Dr. Sarah Ahmed' AND hospital_id = 'city_clinic';

-- Add hours for Dr. John
INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time)
SELECT id, 0, '10:00:00', '14:00:00' -- Sunday
FROM doctors_v2 WHERE name = 'Dr. John Doe' AND hospital_id = 'city_clinic';

INSERT INTO doctor_availability (doctor_id, day_of_week, start_time, end_time)
SELECT id, 1, '10:00:00', '14:00:00' -- Monday
FROM doctors_v2 WHERE name = 'Dr. John Doe' AND hospital_id = 'city_clinic';


-- ============================================================
-- VERIFICATION
-- ============================================================
-- Run these queries to check your data:
-- SELECT * FROM hospitals;
-- SELECT * FROM departments;
-- SELECT * FROM doctors_v2;
-- SELECT * FROM doctor_availability;
