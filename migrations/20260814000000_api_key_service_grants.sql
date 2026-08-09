-- Explicit API key to Model service authorization.
CREATE TABLE IF NOT EXISTS api_key_model_grants (
    api_key_id TEXT NOT NULL,
    virtual_model_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (api_key_id, virtual_model_id),
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
    FOREIGN KEY (virtual_model_id) REFERENCES virtual_models(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_key_model_grants_model
    ON api_key_model_grants(virtual_model_id);

-- Keep existing workspaces migratable: make legacy duplicate display names distinct
-- before enforcing uniqueness for newly created keys.
WITH ranked AS (
    SELECT id, name,
           ROW_NUMBER() OVER (PARTITION BY project_id, LOWER(name) ORDER BY created_at, id) AS position
    FROM api_keys
)
UPDATE api_keys AS keys
SET name = ranked.name || ' (' || ranked.position::text || ')'
FROM ranked
WHERE keys.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_project_name
    ON api_keys(project_id, LOWER(name));
