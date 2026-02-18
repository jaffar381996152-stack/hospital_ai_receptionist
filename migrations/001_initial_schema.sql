-- Migration 001: Initial Schema with Hospital Isolation
-- 
-- PHASE 9: Production database schema
-- All tables include hospital_id for data isolation
-- No PHI stored - only metadata and IDs
--
-- Rollback: DROP TABLE schema_migrations, audit_logs, escalation_records;

-- Migration tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT NOW()
);

-- Audit Logs: METADATA ONLY (No PHI)
-- Stores action logs for compliance and debugging
-- Data field contains ONLY: IDs, timestamps, action types
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT NOT NULL,
    conversation_id TEXT,
    action TEXT NOT NULL,
    actor TEXT,
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for hospital-scoped queries (isolation)
CREATE INDEX IF NOT EXISTS idx_audit_logs_hospital_id ON audit_logs(hospital_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Escalation Records: NO PHI
-- Tracks human handoff events
CREATE TABLE IF NOT EXISTS escalation_records (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    trigger_type TEXT,
    channel TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

-- Index for hospital-scoped queries
CREATE INDEX IF NOT EXISTS idx_escalation_records_hospital_id ON escalation_records(hospital_id);
CREATE INDEX IF NOT EXISTS idx_escalation_records_created_at ON escalation_records(created_at);
CREATE INDEX IF NOT EXISTS idx_escalation_records_status ON escalation_records(status);
