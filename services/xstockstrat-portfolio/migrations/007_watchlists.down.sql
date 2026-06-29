-- Migration: 007_watchlists.down.sql
-- Service: xstockstrat-portfolio
-- Reverses 007_watchlists.up.sql. Drops the child table first for clarity
-- (the ON DELETE CASCADE FK would otherwise handle child rows).

DROP INDEX IF EXISTS portfolio.idx_watchlists_user;
DROP TABLE IF EXISTS portfolio.watchlist_symbols;
DROP TABLE IF EXISTS portfolio.watchlists;
