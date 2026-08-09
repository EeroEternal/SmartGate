-- Usage observability: distinguish upstream-reported usage from local estimates
-- and keep the exact pricing context used for each historical cost estimate.
ALTER TABLE usage_logs ADD COLUMN usage_source TEXT NOT NULL DEFAULT 'unavailable';
ALTER TABLE usage_logs ADD COLUMN usage_confidence TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE usage_logs ADD COLUMN pricing_source TEXT NOT NULL DEFAULT 'unpriced';
ALTER TABLE usage_logs ADD COLUMN input_price_snapshot DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN output_price_snapshot DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN pricing_version TEXT;

CREATE INDEX IF NOT EXISTS idx_usage_logs_source_time ON usage_logs(usage_source, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_logs_pricing_time ON usage_logs(pricing_source, timestamp);
