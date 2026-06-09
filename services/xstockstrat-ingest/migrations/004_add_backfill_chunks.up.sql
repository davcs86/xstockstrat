-- 004_add_backfill_chunks.up.sql
-- Per-chunk backfill progress for resumable/chunked jobs (feature 054).
-- Plain table (operational uuid-keyed state), not a hypertable. Parent is
-- ingest.backfill_jobs (feature 052); chunks cascade-delete with the job.

CREATE TABLE ingest.backfill_chunks (
    chunk_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id        uuid NOT NULL REFERENCES ingest.backfill_jobs(job_id) ON DELETE CASCADE,
    symbols       text[] NOT NULL,
    range_start   timestamptz NOT NULL,
    range_end     timestamptz NOT NULL,
    status        smallint NOT NULL DEFAULT 0,  -- mirrors BackfillStatus enum ordinals
    bars_written  bigint NOT NULL DEFAULT 0,
    error         text,
    attempt_count int NOT NULL DEFAULT 0,
    started_at    timestamptz,
    completed_at  timestamptz
);

-- Serves the resume query: select PENDING/FAILED chunks for a job (FR-2/FR-3).
CREATE INDEX idx_backfill_chunks_job_status ON ingest.backfill_chunks (job_id, status);
