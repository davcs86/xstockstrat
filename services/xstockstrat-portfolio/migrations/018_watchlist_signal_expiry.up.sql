-- Migration: 018_watchlist_signal_expiry.up.sql
-- Service: xstockstrat-portfolio — feature 281: per-entry signal expiry for system-managed watchlist symbols.

CREATE TABLE IF NOT EXISTS portfolio.watchlist_signal_expiry (
  watchlist_id UUID        NOT NULL REFERENCES portfolio.watchlists (watchlist_id) ON DELETE CASCADE,
  symbol       TEXT        NOT NULL,
  valid_until  TIMESTAMPTZ NOT NULL,
  -- NULL = operator-marked "untracked" by the backfill; open-ended tracking is the absence of a row.
  signal_id    BIGINT,
  PRIMARY KEY (watchlist_id, symbol)
);
CREATE INDEX IF NOT EXISTS watchlist_signal_expiry_valid_until_idx
  ON portfolio.watchlist_signal_expiry (valid_until);
