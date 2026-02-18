-- Migration 006: Phase 10 - Audit Logs Table
--
-- Structured audit logging for compliance and trust.
-- Stores all significant system events with hospital isolation.
--
-- Rollback: DROP TABLE IF EXISTS audit_logs;

DROP TABLE IF EXISTS audit_logs;
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,      -- booking, otp, checkin, staff, system
    entity_id TEXT,                 -- ID of the affected entity
    action TEXT NOT NULL,           -- CREATED, CONFIRMED, CANCELLED, etc.
    performed_by TEXT,              -- User/system that performed action
    timestamp TIMESTAMP DEFAULT NOW(),
    metadata JSONB,                 -- Additional context (no PHI)
    
    CONSTRAINT fk_audit_hospital FOREIGN KEY (hospital_id) 
        REFERENCES hospitals(hospital_id) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_hospital ON audit_logs(hospital_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_by ON audit_logs(performed_by);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_hospital_time 
ON audit_logs(hospital_id, timestamp DESC);
