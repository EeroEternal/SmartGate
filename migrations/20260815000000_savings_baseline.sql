-- Project-level single-model baseline for savings estimates.
-- The selected endpoint belongs to the selected Model Service and provides the
-- input/output prices used for the comparison estimate.
CREATE TABLE IF NOT EXISTS savings_baselines (
    project_id TEXT PRIMARY KEY NOT NULL,
    virtual_model_id TEXT NOT NULL,
    endpoint_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (virtual_model_id) REFERENCES virtual_models(id) ON DELETE CASCADE,
    FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_savings_baselines_virtual_model
    ON savings_baselines(virtual_model_id);
