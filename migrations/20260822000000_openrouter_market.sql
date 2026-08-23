-- OpenRouter Market Intelligence & Dynamic Discount Catalog

CREATE TABLE IF NOT EXISTS openrouter_market_models (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_at BIGINT,
    description TEXT,
    context_length INTEGER DEFAULT 0,
    prompt_price_per_1m DOUBLE PRECISION DEFAULT 0,
    completion_price_per_1m DOUBLE PRECISION DEFAULT 0,
    request_price DOUBLE PRECISION DEFAULT 0,
    image_price DOUBLE PRECISION DEFAULT 0,
    discount_ratio DOUBLE PRECISION DEFAULT 0,
    is_free INTEGER NOT NULL DEFAULT 0,
    top_provider_context_length INTEGER,
    top_provider_max_completion_tokens INTEGER,
    top_provider_is_moderated INTEGER DEFAULT 0,
    raw_pricing_json TEXT,
    architecture_json TEXT,
    synced_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_openrouter_market_models_is_free ON openrouter_market_models(is_free);
CREATE INDEX IF NOT EXISTS idx_openrouter_market_models_discount ON openrouter_market_models(discount_ratio DESC);
CREATE INDEX IF NOT EXISTS idx_openrouter_market_models_synced_at ON openrouter_market_models(synced_at DESC);
