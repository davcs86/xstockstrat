-- Migration: 010_positions_realized_accum.down.sql
-- Service: xstockstrat-portfolio
-- Reverses 010 — drops the realized_accum accumulation column.

ALTER TABLE portfolio.positions
  DROP COLUMN IF EXISTS realized_accum;
