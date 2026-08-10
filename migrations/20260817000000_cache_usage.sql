-- Provider-reported prompt/prefix cache usage.
-- NULL means the provider did not report cache metrics; zero means it reported no hit.
ALTER TABLE usage_logs
    ADD COLUMN cache_hit_tokens BIGINT,
    ADD COLUMN cache_write_tokens BIGINT;

CREATE INDEX IF NOT EXISTS idx_usage_logs_cache_time
    ON usage_logs(cache_hit_tokens, cache_write_tokens, timestamp);
