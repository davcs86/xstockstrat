-- Feature 133: strategy user-ownership.
-- Add user_id to analysis.strategies and make the row identity composite (user_id, strategy_id).
-- The seed owner for pre-existing rows is supplied per-environment via ${SEED_USER_ID}, rendered by
-- scripts/db-migrate.sh's scoped `envsubst '$SEED_USER_ID'` (never a file literal — F-01). The guard
-- below RAISEs rather than defaulting (fails.md 2026-08-05 add-ikbr-account-support: a silent
-- user_id="default" failed invisibly), and also catches an un-rendered ${...} literal from a direct
-- `migrate` invocation that bypassed the envsubst step.

ALTER TABLE analysis.strategies ADD COLUMN IF NOT EXISTS user_id TEXT;

DO $$
DECLARE
  seed TEXT := '${SEED_USER_ID}';
  missing INT;
BEGIN
  SELECT count(*) INTO missing FROM analysis.strategies WHERE user_id IS NULL;
  IF missing > 0 THEN
    IF seed IS NULL OR seed = '' OR seed LIKE '%$' || '{%' THEN
      RAISE EXCEPTION 'migration 013: % strategy rows need an owner but SEED_USER_ID is unset/unrendered (got "%")', missing, seed;
    END IF;
    UPDATE analysis.strategies SET user_id = seed WHERE user_id IS NULL;
  END IF;
END $$;

ALTER TABLE analysis.strategies ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE analysis.strategies DROP CONSTRAINT strategies_pkey;
ALTER TABLE analysis.strategies ADD PRIMARY KEY (user_id, strategy_id);
