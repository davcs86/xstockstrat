-- Reverse of 015_watchlist_default_strategy.up.sql
ALTER TABLE portfolio.watchlists
  DROP COLUMN IF EXISTS default_strategy_id;
