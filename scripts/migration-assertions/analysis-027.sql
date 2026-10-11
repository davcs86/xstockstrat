-- analysis 027 (AC-3, AC-4): run by migration-rerun.sh after the contract replay and the refused-down
-- recovery, over fixtures-pre-224.sql + fixtures-post-224.sql.
SELECT set_config('migration_assert.seed_user_id', :'seed_user_id', false);

DO $$
DECLARE
  seed TEXT := current_setting('migration_assert.seed_user_id');
BEGIN
  IF (SELECT user_id FROM analysis.backtest_runs WHERE backtest_id = 'fixture-post-r1')
     IS DISTINCT FROM 'user-a@example.test' THEN
    RAISE EXCEPTION 'AC-3: fixture-post-r1 was not backfilled with its unique strategy owner';
  END IF;
  IF (SELECT user_id FROM analysis.backtest_runs WHERE backtest_id = 'fixture-post-r2') IS DISTINCT FROM seed THEN
    RAISE EXCEPTION 'AC-3: fixture-post-r2 (no strategy owner) was not backfilled with the seed user';
  END IF;
  IF (SELECT user_id FROM analysis.backtest_run_symbols WHERE backtest_id = 'fixture-post-r1' AND symbol = 'AAPL')
       IS DISTINCT FROM 'user-a@example.test'
     OR (SELECT user_id FROM analysis.backtest_details WHERE backtest_id = 'fixture-post-r1')
       IS DISTINCT FROM 'user-a@example.test' THEN
    RAISE EXCEPTION 'AC-3: fixture-post-r1 child rows do not carry the parent owner';
  END IF;
  IF to_regclass('analysis.strategy_scores') IS NOT NULL THEN
    RAISE EXCEPTION 'AC-4: analysis.strategy_scores still exists';
  END IF;
END $$;

DO $$
DECLARE
  raised BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO analysis.backtest_runs (backtest_id, strategy_id, status, user_id)
    VALUES ('fixture-post-null', 'x', 'COMPLETED', NULL);
  EXCEPTION WHEN not_null_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'AC-4: a NULL-owner backtest_runs insert was accepted after 027';
  END IF;
END $$;
