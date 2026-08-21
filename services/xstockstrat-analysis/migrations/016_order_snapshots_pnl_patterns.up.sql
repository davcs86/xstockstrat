-- Migration: 016_order_snapshots_pnl_patterns.up.sql
-- Service: xstockstrat-analysis
-- Feature 042 (order-snapshots-pnl-patterns): the analysis-owned tables that capture the
-- indicator/signal/market context at each order event and attribute realized P&L to those factors.
-- Driven by the ledger StreamEvents consumer (app/engine/pnl_pattern_consumer.py).

-- (1) order_snapshots — one row per captured order-lifecycle event. Timescale hypertable on
-- event_ts (= LedgerEvent.recorded_at, immutable server ts → byte-identical on redelivery).
CREATE TABLE IF NOT EXISTS analysis.order_snapshots (
    id           BIGSERIAL,
    event_id     TEXT        NOT NULL,
    order_id     TEXT        NOT NULL,
    position_id  TEXT        NOT NULL,
    symbol       TEXT        NOT NULL,
    event_type   TEXT        NOT NULL,
    event_ts     TIMESTAMPTZ NOT NULL,
    strategy_id  TEXT,
    side         TEXT,
    quantity     NUMERIC,
    price        NUMERIC,
    ohlcv_bar    JSONB,
    indicators   JSONB,
    signals      JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, event_ts),
    UNIQUE (event_id, event_ts)
);
SELECT create_hypertable('analysis.order_snapshots', 'event_ts', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_order_snapshots_position
    ON analysis.order_snapshots (position_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_order_snapshots_symbol
    ON analysis.order_snapshots (symbol, event_ts DESC);

-- (2) pnl_positions — the synthesized open→close window (position_id is synthesized from
-- user/account/symbol/mode + open window; Order carries no position_id). Not a hypertable.
CREATE TABLE IF NOT EXISTS analysis.pnl_positions (
    id             BIGSERIAL PRIMARY KEY,
    position_id    TEXT        NOT NULL,
    user_id        TEXT        NOT NULL,
    account_id     TEXT        NOT NULL,
    symbol         TEXT        NOT NULL,
    trading_mode   TEXT        NOT NULL,
    strategy_id    TEXT,
    opened_at      TIMESTAMPTZ NOT NULL,
    closed_at      TIMESTAMPTZ,
    realized_pnl   NUMERIC,
    open_event_id  TEXT,
    close_event_id TEXT
);
-- One open position per identity key (account_id included).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_pnl_positions_open
    ON analysis.pnl_positions (user_id, account_id, symbol, trading_mode)
    WHERE closed_at IS NULL;

-- (3) pnl_pattern_samples — raw attribution store, one row per (sealed position × factor).
-- No factor UNIQUE (avoids the NULL-in-UNIQUE signal bug); buckets computed at query time.
CREATE TABLE IF NOT EXISTS analysis.pnl_pattern_samples (
    id              BIGSERIAL PRIMARY KEY,
    symbol          TEXT        NOT NULL,
    strategy_id     TEXT,
    factor_name     TEXT        NOT NULL,
    factor_type     TEXT        NOT NULL,  -- 'indicator' | 'signal'
    indicator_value NUMERIC,               -- NULLABLE (signals have no indicator value)
    signal_present  BOOLEAN,
    realized_pnl    NUMERIC,
    closed_at       TIMESTAMPTZ,
    close_event_id  TEXT,
    position_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_pnl_pattern_samples_symbol
    ON analysis.pnl_pattern_samples (symbol, factor_type, closed_at DESC);

-- (4) ledger_stream_cursor — the consumer's committed global-sequence position (one row/consumer).
CREATE TABLE IF NOT EXISTS analysis.ledger_stream_cursor (
    consumer       TEXT   PRIMARY KEY,
    last_sequence  BIGINT NOT NULL DEFAULT 0
);
