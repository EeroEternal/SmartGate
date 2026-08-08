-- Unit prices for CostAware routing (USD per 1M tokens; 0 = unpriced)
ALTER TABLE endpoints ADD COLUMN input_price_per_1m REAL NOT NULL DEFAULT 0;
ALTER TABLE endpoints ADD COLUMN output_price_per_1m REAL NOT NULL DEFAULT 0;
