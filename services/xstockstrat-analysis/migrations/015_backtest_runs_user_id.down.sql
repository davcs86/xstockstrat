-- Reverse of 015: drop the user_id column (no PK change to undo).

ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS user_id;
