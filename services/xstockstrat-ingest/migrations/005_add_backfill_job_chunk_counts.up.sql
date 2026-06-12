-- 005_add_backfill_job_chunk_counts.up.sql
-- Feature 054 (resumable-chunked-backfills) added chunk planning and the
-- BackfillJob.chunks_total / chunks_completed proto fields, plus servicer code that
-- writes them via update_job(), but never added the backing columns to
-- ingest.backfill_jobs. Every job therefore failed the moment it recorded its chunk
-- plan (update targeted a non-existent column), so jobs appeared stuck in "queued"
-- with "chunks 0 / 0". Add the columns so chunk progress can be persisted and read back.

ALTER TABLE ingest.backfill_jobs
    ADD COLUMN IF NOT EXISTS chunks_total     int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS chunks_completed int NOT NULL DEFAULT 0;
