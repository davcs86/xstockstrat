-- feature 334: reverse 015_backfill_webhook_callback.up.sql
ALTER TABLE ingest.backfill_jobs
    DROP COLUMN IF EXISTS webhook_rejected_at,
    DROP COLUMN IF EXISTS webhook_enqueued_at,
    DROP COLUMN IF EXISTS callback_url;
