-- services/xstockstrat-ingest/migrations/002_newsletter_signals.sql
-- Creates ingest.newsletter_signals TimescaleDB hypertable (7-day chunks by ingested_at).
-- Ingest service transitions from stateless coordinator to owning a DB schema
-- for persisting newsletter/signal data consumed by indicators + analysis.

CREATE SCHEMA IF NOT EXISTS ingest;

CREATE TABLE ingest.newsletter_signals (
    id              BIGSERIAL,
    ingested_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    source          TEXT            NOT NULL,
    symbol          TEXT            NOT NULL,
    direction       TEXT            NOT NULL CHECK (direction IN ('buy','sell','hold','watchlist')),
    conviction      NUMERIC(4,3)    CHECK (conviction BETWEEN 0 AND 1),
    valid_from      TIMESTAMPTZ     NOT NULL,
    valid_until     TIMESTAMPTZ,
    headline        TEXT,
    raw_url         TEXT,
    tags            TEXT[]          NOT NULL DEFAULT '{}',
    PRIMARY KEY (id, ingested_at)
);

SELECT create_hypertable('ingest.newsletter_signals', 'ingested_at', chunk_time_interval => INTERVAL '7 days');

CREATE INDEX ON ingest.newsletter_signals (symbol, ingested_at DESC);
CREATE INDEX ON ingest.newsletter_signals (source, ingested_at DESC);
CREATE INDEX ON ingest.newsletter_signals (valid_from, valid_until);
