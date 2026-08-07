-- 009_signal_dedup_keys.up.sql
-- Service: xstockstrat-ingest
-- Feature 111 — dedup claim table for IngestSignal. A plain (non-hypertable) table, not a
-- unique index on ingest.newsletter_signals itself: that table is a hypertable partitioned
-- on ingested_at, and TimescaleDB requires a hypertable's unique index to include its
-- partition column, which isn't part of this natural dedup key. Same structural workaround
-- already shipped as ledger.idempotency_keys and analysis.fundsignal_emitted. No FK to
-- newsletter_signals.id, matching both precedents (their referenced table's PK also includes
-- a column outside the natural key).
CREATE TABLE IF NOT EXISTS ingest.signal_dedup_keys (
    source      TEXT        NOT NULL,
    symbol      TEXT        NOT NULL,
    direction   TEXT        NOT NULL,
    conviction  NUMERIC(4,3),
    valid_until TIMESTAMPTZ,
    signal_id   BIGINT      NOT NULL,
    claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, symbol, direction)
);
CREATE INDEX IF NOT EXISTS idx_signal_dedup_keys_claimed_at ON ingest.signal_dedup_keys (claimed_at);
