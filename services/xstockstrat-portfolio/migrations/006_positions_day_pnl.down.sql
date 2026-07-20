-- Revert: 006_positions_day_pnl

ALTER TABLE portfolio.positions
    DROP COLUMN IF EXISTS day_pnl,
    DROP COLUMN IF EXISTS day_pnl_pct;
