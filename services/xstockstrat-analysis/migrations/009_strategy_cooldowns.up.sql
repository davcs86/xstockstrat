-- Live-loop re-entry cooldown state (feature 069).
-- One durable last-exit timestamp per (strategy_id, symbol) so the live evaluation loop's
-- per-symbol cooldown survives a service restart (FR-8). Hydrated once at boot into the loop's
-- in-memory _last_exit_at, upserted on every live-loop exit. Backtests NEVER read/write this
-- table (FR-7 — backtest cooldown state is ephemeral, per-RunBacktest, in-memory only).
CREATE TABLE IF NOT EXISTS analysis.strategy_cooldowns (
    strategy_id  TEXT NOT NULL,
    symbol       TEXT NOT NULL,
    last_exit_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (strategy_id, symbol)
);
