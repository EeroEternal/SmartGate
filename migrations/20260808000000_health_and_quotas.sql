-- Endpoint health (product-level routing state)
ALTER TABLE endpoints ADD COLUMN health_status TEXT NOT NULL DEFAULT 'healthy';
ALTER TABLE endpoints ADD COLUMN cooldown_until DATETIME;

-- Project hard limits (NULL = unlimited)
ALTER TABLE projects ADD COLUMN rpm_limit INTEGER;
ALTER TABLE projects ADD COLUMN concurrency_limit INTEGER;

-- API Key hard limits (NULL = unlimited; effective limit is the tighter of key vs project)
ALTER TABLE api_keys ADD COLUMN rpm_limit INTEGER;
ALTER TABLE api_keys ADD COLUMN concurrency_limit INTEGER;
