-- Full per-run backtest detail (feature 068-backtest-results-visualization).
-- result_pb is the serialized analysis.v1.BacktestResult wire bytes ("store what you
-- serve", ledger insights 2026-07-21): no SQL ever inspects the payload; GetBacktest
-- returns it verbatim. FK => a detail row can only exist for a listed summary row
-- (C-10(b) existence parity). completed_at is stamped explicitly from
-- result.completed_at (no DEFAULT) so eviction order and ListBacktests order agree.
CREATE TABLE IF NOT EXISTS analysis.backtest_details (
    backtest_id  TEXT PRIMARY KEY REFERENCES analysis.backtest_runs(backtest_id),
    strategy_id  TEXT NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    result_pb    BYTEA NOT NULL
);

-- Retention eviction scans "newest N per strategy" (same shape as 006's history index).
CREATE INDEX IF NOT EXISTS idx_backtest_details_strategy_completed
    ON analysis.backtest_details (strategy_id, completed_at DESC);
