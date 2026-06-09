-- 003_backfill_jobs.up.sql
-- Durable backfill job state (replaces the in-memory self._jobs dict).
-- Plain table (not a hypertable): low-volume operational state keyed by uuid.
-- The ingest schema was created in migration 000 — no CREATE SCHEMA needed.

CREATE TABLE IF NOT EXISTS ingest.backfill_jobs (
    job_id         UUID PRIMARY KEY,
    symbols        TEXT[] NOT NULL DEFAULT '{}',
    timeframe      TEXT NOT NULL DEFAULT '',
    range_start    TIMESTAMPTZ,
    range_end      TIMESTAMPTZ,
    status         SMALLINT NOT NULL,   -- mirrors BackfillStatus enum (0..5)
    bars_processed BIGINT NOT NULL DEFAULT 0,
    bars_total     BIGINT NOT NULL DEFAULT 0,
    failed_symbols TEXT[] NOT NULL DEFAULT '{}',
    error          TEXT NOT NULL DEFAULT '',
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS backfill_jobs_status_idx     ON ingest.backfill_jobs (status);
CREATE INDEX IF NOT EXISTS backfill_jobs_created_at_idx ON ingest.backfill_jobs (created_at DESC);
