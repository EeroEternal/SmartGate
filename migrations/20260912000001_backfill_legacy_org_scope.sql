-- Historical admin writes created provider accounts and model pools without an owner,
-- which makes them invisible to every org-scoped query (the SaaS API filters on
-- `org_id`). Adopt those rows into the only organization when that is unambiguous;
-- with several organizations an operator has to decide, so they are left untouched.
UPDATE provider_accounts
SET org_id = (SELECT id FROM orgs ORDER BY created_at, id LIMIT 1)
WHERE org_id IS NULL
  AND (SELECT COUNT(*) FROM orgs) = 1;

UPDATE model_pools
SET org_id = (SELECT id FROM orgs ORDER BY created_at, id LIMIT 1)
WHERE org_id IS NULL
  AND (SELECT COUNT(*) FROM orgs) = 1;
