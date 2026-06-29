-- 006_signal_source_type_derived.up.sql
-- Service: xstockstrat-ingest (cross-service change owned by feature 062)
-- Add 'derived' to signal_sources.source_type — a generic bucket for internally-produced
-- (non-extraction) signals (e.g. the fundamentals signal producer). Additive only.
ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check;
ALTER TABLE ingest.signal_sources ADD CONSTRAINT signal_sources_source_type_check
    CHECK (source_type IN (
        'simple_email', 'email_attachment', 'linked_email',
        'simple_website', 'authenticated_website',
        'derived'));
