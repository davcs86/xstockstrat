-- Migration: 011_watchlist_system_managed_source.down.sql
-- Service: xstockstrat-portfolio
-- Reverses 011 in inverse order, restoring the original UNIQUE (user_id, name).

ALTER TABLE portfolio.watchlist_symbols
  DROP COLUMN IF EXISTS source;

DROP INDEX IF EXISTS portfolio.watchlists_user_system_uidx;
DROP INDEX IF EXISTS portfolio.watchlists_user_name_not_system_uidx;

ALTER TABLE portfolio.watchlists
  ADD CONSTRAINT watchlists_user_id_name_key UNIQUE (user_id, name);

ALTER TABLE portfolio.watchlists
  DROP COLUMN IF EXISTS system_managed;
