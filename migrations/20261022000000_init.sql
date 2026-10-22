-- Consolidated SQLite Schema for SmartGate (Control Plane + Free Token Pool + xlite Sync)

-- 1. Organizations
CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    rpm_limit INTEGER,
    concurrency_limit INTEGER,
    daily_spend_limit REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- 3. API Keys
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    metadata TEXT,
    rpm_limit INTEGER,
    concurrency_limit INTEGER,
    daily_spend_limit REAL,
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON api_keys(project_id);

-- 4. Provider Accounts
CREATE TABLE IF NOT EXISTS provider_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    protocol TEXT DEFAULT 'openai' NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. Endpoints (Physical targets)
CREATE TABLE IF NOT EXISTS endpoints (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    upstream_model_id TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    priority INTEGER DEFAULT 1 NOT NULL,
    weight INTEGER DEFAULT 1 NOT NULL,
    health_status TEXT DEFAULT 'healthy' NOT NULL,
    cooldown_until DATETIME,
    input_price_per_1m REAL,
    output_price_per_1m REAL,
    capability_score REAL DEFAULT 0.5 NOT NULL,
    supports_tools INTEGER DEFAULT 1,
    context_length INTEGER DEFAULT 131072,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_endpoints_account_id ON endpoints(account_id);

-- 6. Model Pools (Logical grouping & routing strategy)
CREATE TABLE IF NOT EXISTS model_pools (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT,
    name TEXT NOT NULL,
    strategy TEXT DEFAULT 'capability_aware' NOT NULL,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    tool_trim_enabled INTEGER DEFAULT 0 NOT NULL,
    tool_trim_dry_run INTEGER DEFAULT 1 NOT NULL,
    max_tool_chars INTEGER DEFAULT 8000 NOT NULL,
    session_affinity_enabled INTEGER DEFAULT 0 NOT NULL,
    session_affinity_ttl_secs INTEGER DEFAULT 3600 NOT NULL,
    judge_enabled INTEGER DEFAULT 0 NOT NULL,
    judge_endpoint_id TEXT,
    shadow_enabled INTEGER DEFAULT 0 NOT NULL,
    shadow_virtual_model_id TEXT,
    shadow_sample_rate REAL DEFAULT 0.0 NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 7. Model Pool Endpoints (Membership)
CREATE TABLE IF NOT EXISTS model_pool_endpoints (
    pool_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    priority INTEGER DEFAULT 1 NOT NULL,
    weight INTEGER DEFAULT 1 NOT NULL,
    PRIMARY KEY (pool_id, endpoint_id),
    FOREIGN KEY (pool_id) REFERENCES model_pools(id) ON DELETE CASCADE,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
);

-- 8. Virtual Models (Public names)
CREATE TABLE IF NOT EXISTS virtual_models (
    id TEXT PRIMARY KEY NOT NULL,
    pool_id TEXT NOT NULL,
    name TEXT NOT NULL UNIQUE,
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (pool_id) REFERENCES model_pools(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_virtual_models_pool_id ON virtual_models(pool_id);

-- 9. Project Model Grants (Permissions)
CREATE TABLE IF NOT EXISTS project_model_grants (
    project_id TEXT NOT NULL,
    virtual_model_id TEXT NOT NULL,
    PRIMARY KEY (project_id, virtual_model_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (virtual_model_id) REFERENCES virtual_models(id) ON DELETE CASCADE
);

-- 10. API Key Model Grants (Optional per-key model restrictions)
CREATE TABLE IF NOT EXISTS api_key_model_grants (
    api_key_id TEXT NOT NULL,
    virtual_model_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (api_key_id, virtual_model_id),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
    FOREIGN KEY (virtual_model_id) REFERENCES virtual_models(id) ON DELETE CASCADE
);

-- 11. Usage Logs
CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    org_id TEXT,
    project_id TEXT,
    key_id TEXT,
    virtual_model_id TEXT,
    pool_id TEXT,
    endpoint_id TEXT,
    provider_account_id TEXT,
    prompt_tokens INTEGER DEFAULT 0 NOT NULL,
    completion_tokens INTEGER DEFAULT 0 NOT NULL,
    total_tokens INTEGER DEFAULT 0 NOT NULL,
    cache_hit_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    latency_ms INTEGER DEFAULT 0 NOT NULL,
    status_code INTEGER,
    error_message TEXT,
    metadata TEXT,
    estimated_cost REAL DEFAULT 0.0 NOT NULL,
    routing_strategy TEXT,
    routing_decision TEXT,
    tool_message_chars INTEGER DEFAULT 0 NOT NULL,
    trimmed_chars INTEGER DEFAULT 0 NOT NULL,
    usage_source TEXT,
    usage_confidence TEXT,
    pricing_source TEXT,
    input_price_snapshot REAL DEFAULT 0.0 NOT NULL,
    output_price_snapshot REAL DEFAULT 0.0 NOT NULL,
    pricing_version TEXT,
    session_id TEXT,
    turn_index INTEGER,
    ttft_ms INTEGER,
    cached_input_tokens INTEGER DEFAULT 0,
    affinity_applied INTEGER DEFAULT 0,
    affinity_hit INTEGER DEFAULT 0,
    prefix_hash TEXT,
    context_epoch INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp ON usage_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_key_timestamp ON usage_logs(key_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_project_timestamp ON usage_logs(project_id, timestamp DESC);

-- 12. OpenRouter Market Catalog
CREATE TABLE IF NOT EXISTS openrouter_market_models (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER,
    description TEXT,
    context_length INTEGER DEFAULT 0 NOT NULL,
    prompt_price_per_1m REAL DEFAULT 0.0 NOT NULL,
    completion_price_per_1m REAL DEFAULT 0.0 NOT NULL,
    request_price REAL DEFAULT 0.0 NOT NULL,
    image_price REAL DEFAULT 0.0 NOT NULL,
    discount_ratio REAL DEFAULT 0.0 NOT NULL,
    is_free INTEGER NOT NULL DEFAULT 0,
    top_provider_context_length INTEGER,
    top_provider_max_completion_tokens INTEGER,
    top_provider_is_moderated INTEGER DEFAULT 0 NOT NULL,
    raw_pricing_json TEXT,
    architecture_json TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_openrouter_market_models_is_free ON openrouter_market_models(is_free);

-- 13. Free Token Pool Configuration
CREATE TABLE IF NOT EXISTS free_token_pool_config (
    id TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    default_rpm_limit INTEGER NOT NULL DEFAULT 20,
    default_concurrency_limit INTEGER NOT NULL DEFAULT 2,
    default_daily_spend_limit REAL NOT NULL DEFAULT 5.0,
    max_keys_per_ip_per_hour INTEGER NOT NULL DEFAULT 10,
    pool_id TEXT NOT NULL DEFAULT 'pool_free_tokens',
    project_id TEXT NOT NULL DEFAULT 'proj_free_tokens',
    org_id TEXT NOT NULL DEFAULT 'org_free_tokens',
    openrouter_api_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 14. Seed Default Free Token Pool & SmartGate Auto/Pro/Flash Models
INSERT INTO orgs (id, name, description)
VALUES ('org_free_tokens', 'Free Token Community', 'Default organization for public free token pool')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (id, org_id, name, description, rpm_limit, concurrency_limit, daily_spend_limit)
VALUES ('proj_free_tokens', 'org_free_tokens', 'Free Tier', 'Public project for community free token keys', 1000, 100, 1000.0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO provider_accounts (id, org_id, name, provider_type, protocol, base_url, api_key, status)
VALUES ('pa_openrouter_free', 'org_free_tokens', 'SmartGate Free Pool', 'openrouter', 'openai', 'https://openrouter.ai/api/v1', '', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_pools (id, org_id, name, strategy, enabled)
VALUES
  ('pool_free_tokens', 'org_free_tokens', 'free-token-pool', 'capability_aware', TRUE),
  ('pool_deepseek_r1', 'org_free_tokens', 'smartgate/deepseek-r1:1', 'priority', TRUE),
  ('pool_deepseek_chat', 'org_free_tokens', 'smartgate/deepseek-chat:1', 'priority', TRUE),
  ('pool_glm_4', 'org_free_tokens', 'smartgate/glm-4:1', 'priority', TRUE),
  ('pool_llama_3_3_70b', 'org_free_tokens', 'smartgate/llama-70b:1', 'priority', TRUE),
  ('pool_qwen_2_5_coder', 'org_free_tokens', 'smartgate/qwen-coder:1', 'priority', TRUE),
  ('pool_gemini_2_flash', 'org_free_tokens', 'smartgate/gemini-flash:1', 'priority', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO endpoints (
    id, account_id, name, upstream_model_id, enabled, priority, weight,
    health_status, input_price_per_1m, output_price_per_1m, capability_score, supports_tools, context_length
) VALUES
  ('ep_or_deepseek_deepseek_r1_free', 'pa_openrouter_free', 'SmartGate DeepSeek R1', 'deepseek/deepseek-r1:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.95, 1, 65536),
  ('ep_or_deepseek_deepseek_chat_free', 'pa_openrouter_free', 'SmartGate DeepSeek V3', 'deepseek/deepseek-chat:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.90, 1, 65536),
  ('ep_or_thudm_glm_4_9b_chat_free', 'pa_openrouter_free', 'SmartGate GLM-4', 'thudm/glm-4-9b-chat:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.85, 1, 32768),
  ('ep_or_meta_llama_llama_3_3_70b_instruct_free', 'pa_openrouter_free', 'SmartGate Llama 3.3 70B', 'meta-llama/llama-3.3-70b-instruct:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.88, 1, 131072),
  ('ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 'pa_openrouter_free', 'SmartGate Qwen 2.5 Coder', 'qwen/qwen-2.5-coder-32b-instruct:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.87, 1, 32768),
  ('ep_or_google_gemini_2_0_flash_exp_free', 'pa_openrouter_free', 'SmartGate Gemini 2.0 Flash', 'google/gemini-2.0-flash-exp:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.72, 1, 1048576)
ON CONFLICT (id) DO NOTHING;

INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight)
VALUES
  ('pool_deepseek_r1', 'ep_or_deepseek_deepseek_r1_free', 10, 10),
  ('pool_deepseek_chat', 'ep_or_deepseek_deepseek_chat_free', 10, 10),
  ('pool_glm_4', 'ep_or_thudm_glm_4_9b_chat_free', 10, 10),
  ('pool_llama_3_3_70b', 'ep_or_meta_llama_llama_3_3_70b_instruct_free', 10, 10),
  ('pool_qwen_2_5_coder', 'ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 10, 10),
  ('pool_gemini_2_flash', 'ep_or_google_gemini_2_0_flash_exp_free', 10, 10),
  ('pool_free_tokens', 'ep_or_deepseek_deepseek_r1_free', 100, 10),
  ('pool_free_tokens', 'ep_or_deepseek_deepseek_chat_free', 90, 10),
  ('pool_free_tokens', 'ep_or_thudm_glm_4_9b_chat_free', 80, 10),
  ('pool_free_tokens', 'ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 70, 10),
  ('pool_free_tokens', 'ep_or_meta_llama_llama_3_3_70b_instruct_free', 60, 10),
  ('pool_free_tokens', 'ep_or_google_gemini_2_0_flash_exp_free', 50, 10)
ON CONFLICT (pool_id, endpoint_id) DO UPDATE SET
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight;

INSERT INTO virtual_models (id, pool_id, name, enabled)
VALUES
  ('vm_sg_auto', 'pool_free_tokens', 'smartgate/auto', TRUE),
  ('vm_free_auto', 'pool_free_tokens', 'auto', TRUE),
  ('vm_free_chat', 'pool_free_tokens', 'free-chat', TRUE),
  ('vm_sg_deepseek_r1_1', 'pool_deepseek_r1', 'smartgate/deepseek-r1:1', TRUE),
  ('vm_sg_deepseek_chat_1', 'pool_deepseek_chat', 'smartgate/deepseek-chat:1', TRUE),
  ('vm_sg_glm_4_1', 'pool_glm_4', 'smartgate/glm-4:1', TRUE),
  ('vm_sg_qwen_coder_1', 'pool_qwen_2_5_coder', 'smartgate/qwen-coder:1', TRUE),
  ('vm_sg_llama_70b_1', 'pool_llama_3_3_70b', 'smartgate/llama-70b:1', TRUE),
  ('vm_sg_gemini_flash_1', 'pool_gemini_2_flash', 'smartgate/gemini-flash:1', TRUE),
  ('vm_sg_deepseek_r1', 'pool_deepseek_r1', 'smartgate/deepseek-r1', TRUE),
  ('vm_sg_deepseek_chat', 'pool_deepseek_chat', 'smartgate/deepseek-chat', TRUE),
  ('vm_sg_glm_4', 'pool_glm_4', 'smartgate/glm-4', TRUE),
  ('vm_sg_qwen_coder', 'pool_qwen_2_5_coder', 'smartgate/qwen-coder', TRUE),
  ('vm_sg_llama_70b', 'pool_llama_3_3_70b', 'smartgate/llama-70b', TRUE),
  ('vm_sg_gemini_flash', 'pool_gemini_2_flash', 'smartgate/gemini-flash', TRUE),
  ('vm_or_deepseek_r1', 'pool_deepseek_r1', 'deepseek/deepseek-r1:free', TRUE),
  ('vm_or_deepseek_chat', 'pool_deepseek_chat', 'deepseek/deepseek-chat:free', TRUE),
  ('vm_or_glm_4', 'pool_glm_4', 'thudm/glm-4-9b-chat:free', TRUE),
  ('vm_or_llama_3_3_70b', 'pool_llama_3_3_70b', 'meta-llama/llama-3.3-70b-instruct:free', TRUE),
  ('vm_or_qwen_2_5_coder', 'pool_qwen_2_5_coder', 'qwen/qwen-2.5-coder-32b-instruct:free', TRUE),
  ('vm_or_gemini_2_flash', 'pool_gemini_2_flash', 'google/gemini-2.0-flash-exp:free', TRUE)
ON CONFLICT (id) DO UPDATE SET pool_id = EXCLUDED.pool_id, enabled = TRUE;

INSERT INTO project_model_grants (project_id, virtual_model_id)
VALUES
  ('proj_free_tokens', 'vm_sg_auto'),
  ('proj_free_tokens', 'vm_free_auto'),
  ('proj_free_tokens', 'vm_free_chat'),
  ('proj_free_tokens', 'vm_sg_deepseek_r1_1'),
  ('proj_free_tokens', 'vm_sg_deepseek_chat_1'),
  ('proj_free_tokens', 'vm_sg_glm_4_1'),
  ('proj_free_tokens', 'vm_sg_qwen_coder_1'),
  ('proj_free_tokens', 'vm_sg_llama_70b_1'),
  ('proj_free_tokens', 'vm_sg_gemini_flash_1'),
  ('proj_free_tokens', 'vm_sg_deepseek_r1'),
  ('proj_free_tokens', 'vm_sg_deepseek_chat'),
  ('proj_free_tokens', 'vm_sg_glm_4'),
  ('proj_free_tokens', 'vm_sg_qwen_coder'),
  ('proj_free_tokens', 'vm_sg_llama_70b'),
  ('proj_free_tokens', 'vm_sg_gemini_flash'),
  ('proj_free_tokens', 'vm_or_deepseek_r1'),
  ('proj_free_tokens', 'vm_or_deepseek_chat'),
  ('proj_free_tokens', 'vm_or_glm_4'),
  ('proj_free_tokens', 'vm_or_llama_3_3_70b'),
  ('proj_free_tokens', 'vm_or_qwen_2_5_coder'),
  ('proj_free_tokens', 'vm_or_gemini_2_flash')
ON CONFLICT (project_id, virtual_model_id) DO NOTHING;

INSERT INTO free_token_pool_config (id, enabled, default_rpm_limit, default_concurrency_limit, default_daily_spend_limit, max_keys_per_ip_per_hour, pool_id, project_id, org_id)
VALUES ('default', TRUE, 20, 2, 5.0, 10, 'pool_free_tokens', 'proj_free_tokens', 'org_free_tokens')
ON CONFLICT (id) DO NOTHING;
