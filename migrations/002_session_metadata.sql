-- Migration 002: Session Metadata
-- 
-- Stores session metadata for abuse tracking
-- NO raw messages, NO PHI
--
-- Rollback: DROP TABLE session_metadata;

CREATE TABLE IF NOT EXISTS session_metadata (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT NOT NULL,
    session_id TEXT NOT NULL UNIQUE,
    language TEXT,
    consent_given BOOLEAN DEFAULT FALSE,
    consent_at TIMESTAMP,
    escalated_at TIMESTAMP,
    escalation_reason TEXT,
    abuse_warning_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    last_activity TIMESTAMP DEFAULT NOW()
);

-- Index for hospital-scoped queries
CREATE INDEX IF NOT EXISTS idx_session_metadata_hospital_id ON session_metadata(hospital_id);
CREATE INDEX IF NOT EXISTS idx_session_metadata_session_id ON session_metadata(session_id);
CREATE INDEX IF NOT EXISTS idx_session_metadata_last_activity ON session_metadata(last_activity);
