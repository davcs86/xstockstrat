-- 002_add_signal_sources_registry.up.sql
-- Adds the ingest.signal_sources registry table.
-- The ingest schema was created in migration 001 — no CREATE SCHEMA needed.

CREATE TABLE IF NOT EXISTS ingest.signal_sources (
    slug             TEXT PRIMARY KEY,
    display_name     TEXT NOT NULL,
    source_type      TEXT NOT NULL CHECK (source_type IN (
                         'simple_email', 'email_attachment', 'linked_email',
                         'simple_website', 'authenticated_website')),
    extractor_module TEXT NOT NULL,
    credentials_ref  TEXT,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    config_json      JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signal_sources_active_idx
    ON ingest.signal_sources (active);
