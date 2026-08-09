-- Personal SaaS MVP: account sessions and resource ownership.
CREATE TABLE IF NOT EXISTS saas_users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS saas_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES saas_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS org_memberships (
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (org_id, user_id),
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES saas_users(id) ON DELETE CASCADE
);

ALTER TABLE provider_accounts ADD COLUMN org_id TEXT REFERENCES orgs(id);
ALTER TABLE model_pools ADD COLUMN org_id TEXT REFERENCES orgs(id);

CREATE INDEX IF NOT EXISTS idx_saas_sessions_token ON saas_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_accounts_org ON provider_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_model_pools_org ON model_pools(org_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_key_time ON usage_logs(key_id, timestamp);
