-- Migration: 001_orders_hypertable.sql
-- Service: xstockstrat-trading
-- Creates orders table as TimescaleDB hypertable

CREATE SCHEMA IF NOT EXISTS trading;

CREATE TABLE IF NOT EXISTS trading.orders (
    order_id            UUID        NOT NULL,
    client_order_id     TEXT,
    symbol              TEXT        NOT NULL,
    side                TEXT        NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type          TEXT        NOT NULL,
    status              TEXT        NOT NULL,
    qty                 NUMERIC(18,8) NOT NULL,
    filled_qty          NUMERIC(18,8) NOT NULL DEFAULT 0,
    limit_price         NUMERIC(18,8),
    stop_price          NUMERIC(18,8),
    filled_avg_price    NUMERIC(18,8),
    time_in_force       TEXT,
    strategy_id         TEXT,
    user_id             TEXT        NOT NULL,
    requires_approval   BOOLEAN     NOT NULL DEFAULT FALSE,
    approved_by         TEXT,
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (order_id, created_at)
);

-- Convert to TimescaleDB hypertable, partitioned by day
SELECT create_hypertable(
    'trading.orders',
    'created_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_orders_user_id     ON trading.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_symbol      ON trading.orders (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status      ON trading.orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_strategy    ON trading.orders (strategy_id, created_at DESC);

-- Approval queue view
CREATE OR REPLACE VIEW trading.pending_approval AS
    SELECT * FROM trading.orders
    WHERE status = 'pending_approval'
    ORDER BY created_at ASC;
