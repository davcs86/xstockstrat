-- Reverse 017_backtest_runs_sizing.up.sql (feature 150).
ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS max_concurrent;
ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS position_weight;
ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS sizing_mode;
