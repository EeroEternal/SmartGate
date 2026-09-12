-- Unit prices for CostAware routing (USD per 1M tokens).
--
-- The pricing profile needs to tell "no price configured" apart from "this model is
-- free", because CostAware must not rank an endpoint of unknown cost as the cheapest
-- option. NULL now means unpriced/unknown, while 0 keeps its literal meaning (a free
-- model, which the model catalog writes explicitly).
--
-- Existing rows keep their value: a stored 0 stays a free endpoint. Only writes that
-- omit the price now store NULL.
ALTER TABLE endpoints ALTER COLUMN input_price_per_1m DROP NOT NULL;
ALTER TABLE endpoints ALTER COLUMN output_price_per_1m DROP NOT NULL;
ALTER TABLE endpoints ALTER COLUMN input_price_per_1m DROP DEFAULT;
ALTER TABLE endpoints ALTER COLUMN output_price_per_1m DROP DEFAULT;
