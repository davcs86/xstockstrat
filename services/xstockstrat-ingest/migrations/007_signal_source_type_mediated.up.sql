-- 007_signal_source_type_mediated.up.sql
-- Service: xstockstrat-ingest
-- Add the five Claude-mediated source types to the signal_sources.source_type CHECK.
-- Feature 008 (FR-2) specifies ten source_type values — five programmatic and five
-- mediated — but the committed CHECK only ever carried the programmatic five (plus
-- 'derived' from migration 006), so registering any mediated source violated the
-- constraint. Additive only: no existing rows can be invalidated by widening a CHECK.
ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check;
ALTER TABLE ingest.signal_sources ADD CONSTRAINT signal_sources_source_type_check
    CHECK (source_type IN (
        'simple_email', 'email_attachment', 'linked_email',
        'simple_website', 'authenticated_website',
        'mediated_simple_email', 'mediated_email_attachment', 'mediated_linked_email',
        'mediated_simple_website', 'mediated_authenticated_website',
        'derived'));
