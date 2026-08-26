-- 012_offline_account_realized.up.sql
-- Service: xstockstrat-portfolio
-- Feature 157 (offline-account-portfolios): account-grain realized P&L for OFFLINE accounts.
-- Account-grain (account_id PK), NOT per-position realized_accum — the per-position accumulator
-- is deleted by DeletePositionsNotInSync when a position fully closes, which would lose realized
-- P&L on a full close. This table survives the position-row wipe.

CREATE TABLE IF NOT EXISTS portfolio.offline_account_realized (
  account_id   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  trading_mode TEXT NOT NULL,
  realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
