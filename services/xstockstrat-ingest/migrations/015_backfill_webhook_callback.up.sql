-- feature 334: callback URL and once-per-job hand-off markers for backfill completion webhooks.
ALTER TABLE ingest.backfill_jobs
    ADD COLUMN IF NOT EXISTS callback_url text,
    ADD COLUMN IF NOT EXISTS webhook_enqueued_at timestamptz,
    ADD COLUMN IF NOT EXISTS webhook_rejected_at timestamptz;
