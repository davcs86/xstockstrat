-- Reverse of 021_pnl_positions_fees_total.up.sql (drop index first, then column)
DROP INDEX IF EXISTS analysis.idx_pnl_positions_user_closed;
ALTER TABLE analysis.pnl_positions
  DROP COLUMN IF EXISTS fees_total;
