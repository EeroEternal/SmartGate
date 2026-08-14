-- Session affinity routing + warming observability (Postgres)

ALTER TABLE model_pools ADD COLUMN IF NOT EXISTS session_affinity_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE model_pools ADD COLUMN IF NOT EXISTS session_affinity_ttl_secs INTEGER NOT NULL DEFAULT 3600;

ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS turn_index INTEGER;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS ttft_ms INTEGER;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cached_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS affinity_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS affinity_hit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS prefix_hash TEXT;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS context_epoch INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_usage_logs_session ON usage_logs(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_logs_pool_turn ON usage_logs(pool_id, turn_index);

UPDATE model_pools SET session_affinity_enabled = 1 WHERE session_affinity_enabled = 0;
