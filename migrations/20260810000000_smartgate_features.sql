-- Capability profile (lightweight smart routing)
ALTER TABLE endpoints ADD COLUMN capability_score DOUBLE PRECISION NOT NULL DEFAULT 0.5;
ALTER TABLE endpoints ADD COLUMN supports_tools INTEGER;
ALTER TABLE endpoints ADD COLUMN context_length INTEGER;

-- Spend budgets (NULL = unlimited). Soft gate at 80%, hard at 100%.
ALTER TABLE api_keys ADD COLUMN daily_spend_limit DOUBLE PRECISION;
ALTER TABLE projects ADD COLUMN daily_spend_limit DOUBLE PRECISION;

-- Usage: estimated spend + routing / context observability
ALTER TABLE usage_logs ADD COLUMN estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN routing_strategy TEXT;
ALTER TABLE usage_logs ADD COLUMN routing_decision TEXT;
ALTER TABLE usage_logs ADD COLUMN tool_message_chars INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN trimmed_chars INTEGER NOT NULL DEFAULT 0;

-- Pool-level context trim policy (gateway safety net)
ALTER TABLE model_pools ADD COLUMN tool_trim_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_pools ADD COLUMN tool_trim_dry_run INTEGER NOT NULL DEFAULT 1;
ALTER TABLE model_pools ADD COLUMN max_tool_chars INTEGER NOT NULL DEFAULT 8000;
