-- Migration: 001_marketdata_hypertables.sql
-- Service: xstockstrat-marketdata
-- Creates TimescaleDB hypertables for OHLCV bars and quotes

CREATE SCHEMA IF NOT EXISTS marketdata;

-- ── OHLCV bars hypertable ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketdata.ohlcv (
    time            TIMESTAMPTZ     NOT NULL,
    symbol          TEXT            NOT NULL,
    timeframe       TEXT            NOT NULL,  -- '1m','5m','1h','1d'
    open            NUMERIC(18,8)   NOT NULL,
    high            NUMERIC(18,8)   NOT NULL,
    low             NUMERIC(18,8)   NOT NULL,
    close           NUMERIC(18,8)   NOT NULL,
    volume          BIGINT          NOT NULL,
    vwap            NUMERIC(18,8),
    trade_count     INTEGER,
    source          TEXT            NOT NULL DEFAULT 'alpaca',
    PRIMARY KEY (symbol, timeframe, time)
);

SELECT create_hypertable(
    'marketdata.ohlcv',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Compress chunks older than 7 days
ALTER TABLE marketdata.ohlcv SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol,timeframe'
);
SELECT add_compression_policy('marketdata.ohlcv', INTERVAL '7 days');

-- Retention: keep 5 years of data
SELECT add_retention_policy('marketdata.ohlcv', INTERVAL '5 years');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_time
    ON marketdata.ohlcv (symbol, time DESC);
CREATE INDEX IF NOT EXISTS idx_ohlcv_timeframe_time
    ON marketdata.ohlcv (timeframe, time DESC);


-- ── Real-time quotes hypertable ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketdata.quotes (
    time            TIMESTAMPTZ     NOT NULL,
    symbol          TEXT            NOT NULL,
    ask_price       NUMERIC(18,8)   NOT NULL,
    ask_size        INTEGER         NOT NULL,
    bid_price       NUMERIC(18,8)   NOT NULL,
    bid_size        INTEGER         NOT NULL,
    source          TEXT            NOT NULL DEFAULT 'alpaca',
    PRIMARY KEY (symbol, time)
);

SELECT create_hypertable(
    'marketdata.quotes',
    'time',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

ALTER TABLE marketdata.quotes SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol'
);
SELECT add_compression_policy('marketdata.quotes', INTERVAL '24 hours');
SELECT add_retention_policy('marketdata.quotes', INTERVAL '90 days');

CREATE INDEX IF NOT EXISTS idx_quotes_symbol_time
    ON marketdata.quotes (symbol, time DESC);


-- ── Continuous aggregates — 1-hour OHLCV from 1-min bars ─────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS marketdata.ohlcv_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    symbol,
    FIRST(open,  time) AS open,
    MAX(high)         AS high,
    MIN(low)          AS low,
    LAST(close,  time) AS close,
    SUM(volume)       AS volume
FROM marketdata.ohlcv
WHERE timeframe = '1m'
GROUP BY bucket, symbol
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
    'marketdata.ohlcv_1h',
    start_offset  => INTERVAL '2 hours',
    end_offset    => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes'
);
