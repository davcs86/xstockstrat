-- Per-account balance snapshot synced from the broker (cash, buying power,
-- equity, previous-close equity). One row per broker account; upserted on each
-- account.balance.synced event. Distinct from portfolio.snapshots (time-series
-- equity history) — this holds only the latest broker-reported balance.
CREATE TABLE IF NOT EXISTS portfolio.account_balances (
    account_id   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    trading_mode TEXT NOT NULL,
    cash         DOUBLE PRECISION NOT NULL DEFAULT 0,
    buying_power DOUBLE PRECISION NOT NULL DEFAULT 0,
    equity       DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_equity  DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_balances_user_id_idx ON portfolio.account_balances (user_id);
