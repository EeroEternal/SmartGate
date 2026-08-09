ALTER TABLE provider_accounts
    ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'openai';

UPDATE provider_accounts
SET protocol = 'anthropic'
WHERE LOWER(provider_type) IN ('anthropic', 'claude')
  AND protocol = 'openai';
