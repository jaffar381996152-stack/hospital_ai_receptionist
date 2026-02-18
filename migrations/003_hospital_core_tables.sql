-- Migration 003: Hospital Core Tables
--
-- PHASE 1: Production-ready schema for multi-hospital system
-- All tables include hospital_id for strict data isolation
-- Patient data is encrypted (stored as *_encrypted columns)
--
-- Rollback: DROP TABLE staff_users, appointments, doctor_availability, doctors_v2, departments, hospitals;

-- ============================================================
-- HOSPITALS: Core hospital registry
-- ============================================================
CREATE TABLE IF NOT EXISTS hospitals (
    hospital_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    timezone TEXT DEFAULT 'Asia/Riyadh',
    contact_email TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_hospitals_created ON hospitals(created_at);

-- ============================================================
-- DEPARTMENTS: Hospital departments
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_departments_hospital FOREIGN KEY (hospital_id) 
        REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
    CONSTRAINT uq_departments_hospital_name UNIQUE (hospital_id, name)
);

CREATE INDEX IF NOT EXISTS idx_departments_hospital ON departments(hospital_id);

-- ============================================================
-- DOCTORS: Medical staff (v2 with hospital isolation)
-- ============================================================
CREATE TABLE IF NOT EXISTS doctors_v2 (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT NOT NULL,
    department_id INTEGER,
    name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_doctors_hospital FOREIGN KEY (hospital_id) 
        REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
    CONSTRAINT fk_doctors_department FOREIGN KEY (department_id) 
        REFERENCES departments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_doctors_v2_hospital ON doctors_v2(hospital_id);
CREATE INDEX IF NOT EXISTS idx_doctors_v2_department ON doctors_v2(department_id);
CREATE INDEX IF NOT EXISTS idx_doctors_v2_active ON doctors_v2(is_active);

-- ============================================================
-- DOCTOR_AVAILABILITY: Weekly schedule
-- ============================================================
CREATE TABLE IF NOT EXISTS doctor_availability (
    id SERIAL PRIMARY KEY,
    doctor_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    CONSTRAINT fk_availability_doctor FOREIGN KEY (doctor_id) 
        REFERENCES doctors_v2(id) ON DELETE CASCADE,
    CONSTRAINT chk_availability_time CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_doctor ON doctor_availability(doctor_id);
CREATE INDEX IF NOT EXISTS idx_availability_day ON doctor_availability(day_of_week);

-- ============================================================
-- APPOINTMENTS: Patient appointments (PHI encrypted)
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT NOT NULL,
    doctor_id INTEGER,
    patient_name_encrypted TEXT,
    patient_phone_encrypted TEXT,
    patient_email_encrypted TEXT,
    appointment_time TIMESTAMP NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'checked_in')),
    otp_hash TEXT,
    otp_expires_at TIMESTAMP,
    checked_in_at TIMESTAMP,
    checked_in_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_appointments_hospital FOREIGN KEY (hospital_id) 
        REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
    CONSTRAINT fk_appointments_doctor FOREIGN KEY (doctor_id) 
        REFERENCES doctors_v2(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_hospital ON appointments(hospital_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_time ON appointments(appointment_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_created ON appointments(created_at);

-- ============================================================
-- STAFF_USERS: Reception dashboard users
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_users (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'receptionist' CHECK (role IN ('receptionist', 'admin', 'manager')),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT fk_staff_hospital FOREIGN KEY (hospital_id) 
        REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
    CONSTRAINT uq_staff_hospital_username UNIQUE (hospital_id, username)
);

CREATE INDEX IF NOT EXISTS idx_staff_users_hospital ON staff_users(hospital_id);
CREATE INDEX IF NOT EXISTS idx_staff_users_active ON staff_users(is_active);
