-- Reverse of 014_positions_fees_accum.up.sql
ALTER TABLE portfolio.positions
  DROP COLUMN IF EXISTS fees_accum;
