-- Cross-stock score derivation (feature 065).
-- Persist one (symbol × window) evidence cell per completed RunBacktest so the headline
-- strategy grade can be derived from breadth + duration of per-symbol evidence rather than
-- overwritten last-run-wins. Runs are arbitrary user-shaped containers; cells make breadth
-- measurable and kill overlapping-run double-counting. Also record the backtest range on the
-- run-history row and evidence provenance on the materialized strategy_scores cache.

CREATE TABLE IF NOT EXISTS analysis.backtest_run_symbols (
    backtest_id            TEXT NOT NULL,
    strategy_id            TEXT NOT NULL,
    symbol                 TEXT NOT NULL,
    sharpe_ratio           DOUBLE PRECISION NOT NULL DEFAULT 0,
    max_drawdown           DOUBLE PRECISION NOT NULL DEFAULT 0,
    win_rate               DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_return           DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_trades           INTEGER NOT NULL DEFAULT 0,
    trading_days           INTEGER NOT NULL,
    definition_fingerprint TEXT NULL,
    range_start            TIMESTAMPTZ NULL,
    range_end              TIMESTAMPTZ NULL,
    completed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (backtest_id, symbol)
);

-- Serves the traded-first DISTINCT ON eligibility read: for a (strategy, fingerprint) pick one
-- cell per symbol, traded evidence first, then most trading days, then newest.
CREATE INDEX IF NOT EXISTS idx_brs_eligibility
    ON analysis.backtest_run_symbols
    (strategy_id, definition_fingerprint, symbol, (total_trades > 0) DESC, trading_days DESC, completed_at DESC);

-- Range covered by each run (feature 065); legacy rows leave these NULL.
ALTER TABLE analysis.backtest_runs
    ADD COLUMN IF NOT EXISTS range_start TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS range_end   TIMESTAMPTZ NULL;

-- Evidence provenance for the derived headline grade; pre-007 rows default to zero/false.
ALTER TABLE analysis.strategy_scores
    ADD COLUMN IF NOT EXISTS n_symbols          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_trading_days INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS provisional        BOOLEAN NOT NULL DEFAULT FALSE;
