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

CREATE INDEX IF NOT EXISTS idx_quotes_symbol_time
    ON marketdata.quotes (symbol, time DESC);



