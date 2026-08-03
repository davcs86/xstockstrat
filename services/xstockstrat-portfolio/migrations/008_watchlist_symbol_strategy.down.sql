-- Migration: 008_watchlist_symbol_strategy.down.sql
-- Service: xstockstrat-portfolio
-- Reverses 008_watchlist_symbol_strategy.up.sql (feature 097).

ALTER TABLE portfolio.watchlist_symbols
  DROP COLUMN IF EXISTS strategy_id;
