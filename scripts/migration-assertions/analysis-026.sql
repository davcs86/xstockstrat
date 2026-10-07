-- analysis 026 (AC-15, D-1): run by migration-rerun.sh after pass 1 + replay, over fixtures-pre-224.sql.
SELECT set_config('migration_assert.seed_user_id', :'seed_user_id', false);

DO $$
BEGIN
  IF to_regclass('analysis.strategy_templates') IS NULL THEN
    RAISE EXCEPTION 'AC-15: analysis.strategy_templates does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM analysis.strategy_templates) THEN
    RAISE EXCEPTION 'AC-15: analysis.strategy_templates has seed rows';
  END IF;
END $$;

DO $$
DECLARE
  seed TEXT := current_setting('migration_assert.seed_user_id');
  got  RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM analysis.backtest_runs WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'D-1: % backtest_runs rows still have a NULL user_id',
      (SELECT count(*) FROM analysis.backtest_runs WHERE user_id IS NULL);
  END IF;

  FOR got IN
    SELECT e.backtest_id, e.expected, r.user_id
      FROM (VALUES ('fixture-run-unique', 'user-a@example.test'),
                   ('fixture-run-shared', seed),
                   ('fixture-run-orphan', seed),
                   ('fixture-run-owned', 'user-b@example.test')) AS e (backtest_id, expected)
      LEFT JOIN analysis.backtest_runs r USING (backtest_id)
  LOOP
    IF got.user_id IS DISTINCT FROM got.expected THEN
      RAISE EXCEPTION 'D-1: % has user_id "%", expected "%"', got.backtest_id, got.user_id, got.expected;
    END IF;
  END LOOP;
END $$;
