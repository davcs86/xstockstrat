-- 005_add_backfill_job_chunk_counts.down.sql
ALTER TABLE ingest.backfill_jobs
    DROP COLUMN IF EXISTS chunks_total,
    DROP COLUMN IF EXISTS chunks_completed;
