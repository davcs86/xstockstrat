-- Reverse feature 065 evidence-cell schema.

ALTER TABLE analysis.strategy_scores
    DROP COLUMN IF EXISTS provisional,
    DROP COLUMN IF EXISTS total_trading_days,
    DROP COLUMN IF EXISTS n_symbols;

ALTER TABLE analysis.backtest_runs
    DROP COLUMN IF EXISTS range_end,
    DROP COLUMN IF EXISTS range_start;

DROP INDEX IF EXISTS analysis.idx_brs_eligibility;

DROP TABLE IF EXISTS analysis.backtest_run_symbols;
