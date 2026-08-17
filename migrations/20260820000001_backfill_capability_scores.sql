UPDATE endpoints
SET capability_score = 0.95
WHERE (capability_score IS NULL OR (capability_score >= 0.699 AND capability_score <= 0.701) OR capability_score = 0.0)
  AND (
    LOWER(upstream_model_id) LIKE '%pro%'
    OR LOWER(upstream_model_id) LIKE '%reasoner%'
    OR LOWER(upstream_model_id) LIKE '%opus%'
    OR LOWER(upstream_model_id) LIKE '%sonnet%'
    OR LOWER(upstream_model_id) LIKE '%gpt-4%'
    OR LOWER(upstream_model_id) LIKE '%o1%'
    OR LOWER(upstream_model_id) LIKE '%o3%'
    OR LOWER(upstream_model_id) LIKE '%r1%'
  );

UPDATE endpoints
SET capability_score = 0.65
WHERE (capability_score IS NULL OR (capability_score >= 0.699 AND capability_score <= 0.701) OR capability_score = 0.0)
  AND (
    LOWER(upstream_model_id) LIKE '%flash%'
    OR LOWER(upstream_model_id) LIKE '%mini%'
    OR LOWER(upstream_model_id) LIKE '%turbo%'
    OR LOWER(upstream_model_id) LIKE '%haiku%'
  );
