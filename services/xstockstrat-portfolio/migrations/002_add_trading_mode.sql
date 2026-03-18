-- Migration: 002_add_trading_mode.sql
-- Service: xstockstrat-portfolio
-- Adds trading_mode to positions and snapshots for paper/live isolation.

ALTER TABLE portfolio.positions
    ADD COLUMN IF NOT EXISTS trading_mode TEXT NOT NULL DEFAULT 'TRADING_MODE_PAPER';

-- Drop old unique constraint (user_id, symbol) and replace with (user_id, symbol, trading_mode)
ALTER TABLE portfolio.positions
    DROP CONSTRAINT IF EXISTS positions_user_id_symbol_key;

ALTER TABLE portfolio.positions
    ADD CONSTRAINT positions_user_id_symbol_trading_mode_key
    UNIQUE (user_id, symbol, trading_mode);

ALTER TABLE portfolio.snapshots
    ADD COLUMN IF NOT EXISTS trading_mode TEXT NOT NULL DEFAULT 'TRADING_MODE_PAPER';

CREATE INDEX IF NOT EXISTS idx_snapshots_trading_mode
    ON portfolio.snapshots (trading_mode, snapshot_time DESC);

CREATE INDEX IF NOT EXISTS idx_positions_trading_mode
    ON portfolio.positions (user_id, trading_mode);
