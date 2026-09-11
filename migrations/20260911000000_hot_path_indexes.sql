-- Hot-path indexes for append-only usage_logs time-range queries
-- scoped by project, API key, and virtual model.
-- Note: the API key column in usage_logs is named `key_id`.
CREATE INDEX IF NOT EXISTS idx_usage_logs_project_time ON usage_logs (project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_logs_key_time ON usage_logs (key_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_logs_virtual_model_time ON usage_logs (virtual_model_id, timestamp);
