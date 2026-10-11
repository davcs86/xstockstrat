-- contract-of: services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql
-- requires-env: SEED_USER_ID
-- Migration: 027_contract_owner_dimension.up.sql
-- feature 225: contract of 224's 026 (NOT NULL owner, drop strategy_scores); must stay replay-safe.

DO $$
DECLARE
  seed TEXT := '${SEED_USER_ID}';
BEGIN
  IF seed IS NULL OR seed = '' OR seed LIKE '%$' || '{%' THEN
    RAISE EXCEPTION 'migration 027: SEED_USER_ID is unset/unrendered (got "%")', seed;
  END IF;
END $$;

DO $$
DECLARE prev_lt text := current_setting('lock_timeout');
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  FOR i IN 1..20 LOOP
    BEGIN
      LOCK TABLE analysis.backtest_runs IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 20 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', prev_lt, true);
END $$;

-- D-1: a legacy run takes its strategy's owner only when exactly one owner holds that strategy_id.
UPDATE analysis.backtest_runs r
   SET user_id = (
         SELECT min(s.user_id)
           FROM analysis.strategies s
          WHERE s.strategy_id = r.strategy_id
         HAVING count(DISTINCT s.user_id) = 1
       )
 WHERE r.user_id IS NULL;

UPDATE analysis.backtest_runs
   SET user_id = '${SEED_USER_ID}'
 WHERE user_id IS NULL;

UPDATE analysis.backtest_run_symbols b
   SET user_id = r.user_id
  FROM analysis.backtest_runs r
 WHERE b.backtest_id = r.backtest_id AND b.user_id IS NULL;

UPDATE analysis.backtest_details d
   SET user_id = r.user_id
  FROM analysis.backtest_runs r
 WHERE d.backtest_id = r.backtest_id AND d.user_id IS NULL;

ALTER TABLE analysis.backtest_runs ALTER COLUMN user_id SET NOT NULL;

DROP TABLE IF EXISTS analysis.strategy_scores;
