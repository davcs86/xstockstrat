-- Backtest run history (fixes "cannot see past run results").
-- One row per completed RunBacktest, storing summary metrics + the score the run
-- earned. Full trades/diagnostics are intentionally NOT persisted here — this table is a
-- lightweight, queryable history so the UI can list past runs for a strategy.
CREATE TABLE IF NOT EXISTS analysis.backtest_runs (
    backtest_id        TEXT PRIMARY KEY,
    strategy_id        TEXT NOT NULL,
    status             TEXT NOT NULL,
    total_return       DOUBLE PRECISION NOT NULL DEFAULT 0,
    annualized_return  DOUBLE PRECISION NOT NULL DEFAULT 0,
    sharpe_ratio       DOUBLE PRECISION NOT NULL DEFAULT 0,
    max_drawdown       DOUBLE PRECISION NOT NULL DEFAULT 0,
    win_rate           DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_trades       INTEGER NOT NULL DEFAULT 0,
    profit_factor      DOUBLE PRECISION NOT NULL DEFAULT 0,
    symbols            TEXT[] NOT NULL DEFAULT '{}',
    overall_score      DOUBLE PRECISION,
    rating             TEXT,
    completed_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- History reads are always "latest N runs for this strategy".
CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy_completed
    ON analysis.backtest_runs (strategy_id, completed_at DESC);
