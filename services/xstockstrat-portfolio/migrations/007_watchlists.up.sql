-- Migration: 007_watchlists.up.sql
-- Service: xstockstrat-portfolio
-- Creates the watchlist tables (feature 058). Watchlists are user-owned and
-- mode-agnostic (no trading_mode / account_id column, unlike positions).

CREATE TABLE IF NOT EXISTS portfolio.watchlists (
  watchlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS portfolio.watchlist_symbols (
  watchlist_id UUID NOT NULL REFERENCES portfolio.watchlists (watchlist_id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user ON portfolio.watchlists (user_id);
