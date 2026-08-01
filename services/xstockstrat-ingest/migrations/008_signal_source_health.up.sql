-- 008_signal_source_health.up.sql
-- Service: xstockstrat-ingest
-- Feature 083 — add source-health columns to ingest.signal_sources so the Engine →
-- Signal-sources screen can surface LIVE/STALE/DOWN health, last-seen, last-error, and a
-- lifetime fed count. Additive only (last is 007); the returned health status is derived on
-- read from last_seen_at freshness (the stored `health` column is a defaulted placeholder).
ALTER TABLE ingest.signal_sources
    ADD COLUMN IF NOT EXISTS health       TEXT   NOT NULL DEFAULT 'unspecified',
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error   TEXT,
    ADD COLUMN IF NOT EXISTS signals_fed  BIGINT NOT NULL DEFAULT 0;
