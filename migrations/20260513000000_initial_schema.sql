-- 1. Organizations
CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
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
    metadata TEXT, -- JSON string
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 4. Provider Accounts
CREATE TABLE IF NOT EXISTS provider_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL, -- e.g., 'openai', 'azure', 'anthropic', 'deepseek'
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL, -- Encrypted or plain depending on security policy
    status TEXT DEFAULT 'active' NOT NULL,
    metadata TEXT, -- JSON string
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. Endpoints (Physical targets)
CREATE TABLE IF NOT EXISTS endpoints (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    upstream_model_id TEXT NOT NULL, -- The model/deployment name at the provider
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    priority INTEGER DEFAULT 1 NOT NULL,
    weight INTEGER DEFAULT 1 NOT NULL,
    metadata TEXT, -- JSON string
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (account_id) REFERENCES provider_accounts(id) ON DELETE CASCADE
);

-- 6. Model Pools (Logical grouping)
CREATE TABLE IF NOT EXISTS model_pools (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    strategy TEXT DEFAULT 'round_robin' NOT NULL, -- 'round_robin', 'least_connections', 'latency_based', 'priority'
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 7. Model Pool Endpoints (Membership)
CREATE TABLE IF NOT EXISTS model_pool_endpoints (
    pool_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    priority INTEGER DEFAULT 1 NOT NULL, -- Override endpoint priority within this pool
    weight INTEGER DEFAULT 1 NOT NULL,   -- Override endpoint weight within this pool
    PRIMARY KEY (pool_id, endpoint_id),
    FOREIGN KEY (pool_id) REFERENCES model_pools(id) ON DELETE CASCADE,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
);

-- 8. Virtual Models (Public names)
CREATE TABLE IF NOT EXISTS virtual_models (
    id TEXT PRIMARY KEY NOT NULL,
    pool_id TEXT NOT NULL,
    name TEXT NOT NULL UNIQUE, -- The name exposed to the client
    enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (pool_id) REFERENCES model_pools(id) ON DELETE CASCADE
);

-- 9. Project Model Grants (Permissions)
CREATE TABLE IF NOT EXISTS project_model_grants (
    project_id TEXT NOT NULL,
    virtual_model_id TEXT NOT NULL,
    PRIMARY KEY (project_id, virtual_model_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (virtual_model_id) REFERENCES virtual_models(id) ON DELETE CASCADE
);

-- 10. Usage Logs
CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
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
    latency_ms INTEGER DEFAULT 0 NOT NULL,
    status_code INTEGER,
    error_message TEXT,
    metadata TEXT -- JSON string
);

-- 11. Endpoint Metrics (Dynamic scoring)
CREATE TABLE IF NOT EXISTS endpoint_metrics (
    endpoint_id TEXT PRIMARY KEY NOT NULL,
    active_requests INTEGER DEFAULT 0 NOT NULL,
    ema_latency_ms DOUBLE PRECISION DEFAULT 0.0 NOT NULL,
    total_requests INTEGER DEFAULT 0 NOT NULL,
    total_errors INTEGER DEFAULT 0 NOT NULL,
    last_error_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
);
