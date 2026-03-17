-- Migration: 001_portfolio_hypertable.sql
-- Service: xstockstrat-portfolio

CREATE SCHEMA IF NOT EXISTS portfolio;

-- Current open positions (non-hypertable, latest state)
CREATE TABLE IF NOT EXISTS portfolio.positions (
    position_id         UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             TEXT            NOT NULL,
    symbol              TEXT            NOT NULL,
    qty                 NUMERIC(18,8)   NOT NULL,
    avg_entry_price     NUMERIC(18,8)   NOT NULL,
    cost_basis          NUMERIC(18,8)   NOT NULL,
    opened_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_positions_user   ON portfolio.positions (user_id);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON portfolio.positions (symbol);

-- Portfolio snapshots — TimescaleDB hypertable (point-in-time state)
CREATE TABLE IF NOT EXISTS portfolio.snapshots (
    snapshot_time       TIMESTAMPTZ     NOT NULL,
    portfolio_id        TEXT            NOT NULL,
    user_id             TEXT            NOT NULL,
    equity              NUMERIC(18,2)   NOT NULL,
    cash                NUMERIC(18,2)   NOT NULL,
    buying_power        NUMERIC(18,2)   NOT NULL,
    day_pnl             NUMERIC(18,2)   NOT NULL DEFAULT 0,
    open_positions      INTEGER         NOT NULL DEFAULT 0,
    PRIMARY KEY (portfolio_id, snapshot_time)
);

SELECT create_hypertable(
    'portfolio.snapshots',
    'snapshot_time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

ALTER TABLE portfolio.snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'portfolio_id'
);
SELECT add_compression_policy('portfolio.snapshots', INTERVAL '7 days');
SELECT add_retention_policy('portfolio.snapshots', INTERVAL '3 years');

CREATE INDEX IF NOT EXISTS idx_snapshots_user_time
    ON portfolio.snapshots (user_id, snapshot_time DESC);
