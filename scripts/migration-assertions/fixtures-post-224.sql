-- Release-N (post-224, pre-225) rows, loaded by migration-rerun.sh at analysis 026 where user_id is nullable.
-- Not an assertion file: migration-rerun.sh skips fixtures-* in its assertion loop.

-- Headerless release-N runs: unique strategy owner (user-a), and a strategy_id nobody holds (-> seed).
INSERT INTO analysis.backtest_runs (backtest_id, strategy_id, status, user_id)
VALUES ('fixture-post-r1', 'fixture_unique', 'COMPLETED', NULL),
       ('fixture-post-r2', 'fixture_post_gone', 'COMPLETED', NULL);

INSERT INTO analysis.backtest_run_symbols (backtest_id, strategy_id, symbol, trading_days, user_id)
VALUES ('fixture-post-r1', 'fixture_unique', 'AAPL', 1, NULL);

INSERT INTO analysis.backtest_details (backtest_id, strategy_id, completed_at, result_pb, user_id)
VALUES ('fixture-post-r1', 'fixture_unique', NOW(), '\x00'::bytea, NULL);
