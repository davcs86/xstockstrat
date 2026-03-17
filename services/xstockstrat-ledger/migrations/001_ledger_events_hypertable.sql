-- Migration: 001_ledger_events_hypertable.sql
-- Service: xstockstrat-ledger
-- Append-only event store with TimescaleDB hypertable

CREATE SCHEMA IF NOT EXISTS ledger;

-- Global monotonic sequence for ordering
CREATE SEQUENCE IF NOT EXISTS ledger.global_sequence;

-- Core events table — NEVER UPDATE OR DELETE rows in this table
CREATE TABLE IF NOT EXISTS ledger.events (
    event_id        UUID            NOT NULL,
    event_type      TEXT            NOT NULL,  -- e.g. "order.created"
    source_service  TEXT            NOT NULL,  -- originating service
    correlation_id  TEXT,
    stream_key      TEXT            NOT NULL,  -- e.g. "order:uuid", "portfolio:user_id"
    payload         JSONB           NOT NULL DEFAULT '{}',
    metadata        JSONB           NOT NULL DEFAULT '{}',
    occurred_at     TIMESTAMPTZ     NOT NULL,
    recorded_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    sequence        BIGINT          NOT NULL DEFAULT nextval('ledger.global_sequence'),
    PRIMARY KEY (event_id, recorded_at)
);

-- Immutability enforcement: deny UPDATE and DELETE at DB level
CREATE OR REPLACE RULE ledger_no_update AS ON UPDATE TO ledger.events DO INSTEAD NOTHING;
CREATE OR REPLACE RULE ledger_no_delete AS ON DELETE TO ledger.events DO INSTEAD NOTHING;

-- Convert to TimescaleDB hypertable (partition by day)
SELECT create_hypertable(
    'ledger.events',
    'recorded_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Compression: compress chunks older than 3 days
ALTER TABLE ledger.events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'source_service,event_type'
);
SELECT add_compression_policy('ledger.events', INTERVAL '3 days');

-- Retention: keep 2 years
SELECT add_retention_policy('ledger.events', INTERVAL '2 years');

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_stream_key
    ON ledger.events (stream_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type
    ON ledger.events (event_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_source
    ON ledger.events (source_service, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_correlation
    ON ledger.events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_sequence
    ON ledger.events (sequence);

-- NOTIFY trigger for live streaming (used by StreamEvents RPC)
CREATE OR REPLACE FUNCTION ledger.notify_event_inserted()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    channel TEXT;
    payload TEXT;
BEGIN
    channel := 'ledger_stream_' || regexp_replace(NEW.stream_key, '[^a-zA-Z0-9]', '_', 'g');
    payload := row_to_json(NEW)::text;
    -- Trim payload to stay under pg NOTIFY 8KB limit
    IF length(payload) > 7000 THEN
        payload := json_build_object(
            'event_id', NEW.event_id,
            'event_type', NEW.event_type,
            'stream_key', NEW.stream_key,
            'sequence', NEW.sequence,
            'recorded_at', NEW.recorded_at
        )::text;
    END IF;
    PERFORM pg_notify(channel, payload);
    PERFORM pg_notify('ledger_stream_all', payload);
    RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_event_notify
    AFTER INSERT ON ledger.events
    FOR EACH ROW EXECUTE FUNCTION ledger.notify_event_inserted();
