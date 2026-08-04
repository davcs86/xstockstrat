-- Migration: 008_watchlist_symbol_strategy.up.sql
-- Service: xstockstrat-portfolio
-- Adds the per-symbol strategy binding to watchlist_symbols (feature 097).
-- '' = unbound (a bare watched symbol). The (watchlist_id, symbol) PK is
-- unchanged: one strategy per (watchlist, symbol).

ALTER TABLE portfolio.watchlist_symbols
  ADD COLUMN IF NOT EXISTS strategy_id TEXT NOT NULL DEFAULT '';
