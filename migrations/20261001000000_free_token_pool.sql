-- Free Token Pool & Public Claiming Infrastructure

CREATE TABLE IF NOT EXISTS free_token_pool_config (
    id TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    default_rpm_limit INTEGER NOT NULL DEFAULT 20,
    default_concurrency_limit INTEGER NOT NULL DEFAULT 2,
    default_daily_spend_limit DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    max_keys_per_ip_per_hour INTEGER NOT NULL DEFAULT 10,
    pool_id TEXT NOT NULL DEFAULT 'pool_free_tokens',
    project_id TEXT NOT NULL DEFAULT 'proj_free_tokens',
    org_id TEXT NOT NULL DEFAULT 'org_free_tokens',
    openrouter_api_key TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Seed default organization for Free Token community
INSERT INTO orgs (id, name, description)
VALUES ('org_free_tokens', 'Free Token Community', 'Default organization for public free token pool')
ON CONFLICT (id) DO NOTHING;

-- Seed default project for Free Token community
INSERT INTO projects (id, org_id, name, description, rpm_limit, concurrency_limit, daily_spend_limit)
VALUES ('proj_free_tokens', 'org_free_tokens', 'Free Tier', 'Public project for community free token keys', 1000, 100, 1000.0)
ON CONFLICT (id) DO NOTHING;

-- Seed default Model Pool for Free Tokens
INSERT INTO model_pools (id, org_id, name, strategy, enabled)
VALUES ('pool_free_tokens', 'org_free_tokens', 'free-token-pool', 'cost_aware', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Seed default Virtual Model for free-chat
INSERT INTO virtual_models (id, pool_id, name, enabled)
VALUES ('vm_free_chat', 'pool_free_tokens', 'free-chat', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Grant free-chat to Free Tier project
INSERT INTO project_model_grants (project_id, virtual_model_id)
VALUES ('proj_free_tokens', 'vm_free_chat')
ON CONFLICT (project_id, virtual_model_id) DO NOTHING;

-- Seed default auto virtual model
INSERT INTO virtual_models (id, pool_id, name, enabled)
VALUES ('vm_free_auto', 'pool_free_tokens', 'auto', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_model_grants (project_id, virtual_model_id)
VALUES ('proj_free_tokens', 'vm_free_auto')
ON CONFLICT (project_id, virtual_model_id) DO NOTHING;

-- Insert default config row
INSERT INTO free_token_pool_config (id, enabled, default_rpm_limit, default_concurrency_limit, default_daily_spend_limit, max_keys_per_ip_per_hour, pool_id, project_id, org_id)
VALUES ('default', TRUE, 20, 2, 5.0, 10, 'pool_free_tokens', 'proj_free_tokens', 'org_free_tokens')
ON CONFLICT (id) DO NOTHING;
