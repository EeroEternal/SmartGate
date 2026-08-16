-- Recalculate estimated_cost for historic usage_logs that had prompt cache hits
-- Uses snapshot prices or fallback to endpoint pricing with 90% discount on cache hits.
UPDATE usage_logs u
SET estimated_cost = (
    -- Cache miss tokens at input price
    (GREATEST(u.prompt_tokens - COALESCE(u.cache_hit_tokens, 0), 0)::float8 / 1000000.0) * COALESCE(u.input_price_snapshot, e.input_price_per_1m, 0.0)
    -- Cache hit tokens at 10% of input price (90% discount)
    + (LEAST(COALESCE(u.cache_hit_tokens, 0), u.prompt_tokens)::float8 / 1000000.0) * (COALESCE(u.input_price_snapshot, e.input_price_per_1m, 0.0) * 0.1)
    -- Output tokens at output price
    + (u.completion_tokens::float8 / 1000000.0) * COALESCE(u.output_price_snapshot, e.output_price_per_1m, 0.0)
)
FROM endpoints e
WHERE e.id = u.endpoint_id
  AND COALESCE(u.cache_hit_tokens, 0) > 0;
