-- Shadow Flighting: asynchronous traffic mirroring to a flagship model for quality agreement measurement

CREATE TABLE IF NOT EXISTS shadow_evaluations (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT,
    project_id TEXT NOT NULL,
    key_id TEXT,
    original_usage_log_id TEXT,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    virtual_model_id TEXT,
    endpoint_id TEXT,
    provider_type TEXT,
    latency_ms INTEGER DEFAULT 0,
    status_code INTEGER,
    request_preview TEXT,
    response_preview TEXT,
    similarity_score DOUBLE PRECISION,
    agreement INTEGER DEFAULT 0,
    estimated_cost DOUBLE PRECISION DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shadow_evaluations_project_time ON shadow_evaluations(project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_shadow_evaluations_original_log ON shadow_evaluations(original_usage_log_id);

ALTER TABLE model_pools ADD COLUMN IF NOT EXISTS shadow_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_pools ADD COLUMN IF NOT EXISTS shadow_virtual_model_id TEXT;
ALTER TABLE model_pools ADD COLUMN IF NOT EXISTS shadow_sample_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
