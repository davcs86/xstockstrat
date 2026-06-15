-- Revert: 005_positions_broker_valuation

ALTER TABLE portfolio.positions
    DROP COLUMN IF EXISTS current_price,
    DROP COLUMN IF EXISTS market_value,
    DROP COLUMN IF EXISTS unrealized_pnl,
    DROP COLUMN IF EXISTS unrealized_pnl_pct;
