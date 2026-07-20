-- Migration: 002_fundamentals.down.sql
-- Service: xstockstrat-marketdata
-- Reverses 002_fundamentals.up.sql.

DROP INDEX IF EXISTS marketdata.idx_fundamentals_fetched_at;
DROP TABLE IF EXISTS marketdata.fundamentals;
