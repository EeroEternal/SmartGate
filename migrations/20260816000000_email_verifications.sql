-- Email verification codes for SaaS account registration.
CREATE TABLE IF NOT EXISTS saas_email_verifications (
    email TEXT PRIMARY KEY NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_saas_email_verifications_expires
    ON saas_email_verifications(expires_at);
