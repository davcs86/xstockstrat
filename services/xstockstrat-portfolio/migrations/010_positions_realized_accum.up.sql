-- Migration: 010_positions_realized_accum.up.sql
-- Service: xstockstrat-portfolio
-- Feature 042 (order-snapshots-pnl-patterns): cumulative realized P&L accumulated as order fills
-- reduce a position, so the enriched portfolio.position.closed event can carry the sealed realized
-- figure without a second P&L computation. Attribution-stats-only — never a user-facing figure
-- (GetPnL remains the authoritative realized P&L). Plain column (positions is not a hypertable).

ALTER TABLE portfolio.positions
  ADD COLUMN IF NOT EXISTS realized_accum NUMERIC NOT NULL DEFAULT 0;
