-- 006_signal_source_type_derived.down.sql
-- Re-adding the stricter constraint fails if any 'derived' row exists, so remove them first.
DELETE FROM ingest.signal_sources WHERE source_type = 'derived';
ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check;
ALTER TABLE ingest.signal_sources ADD CONSTRAINT signal_sources_source_type_check
    CHECK (source_type IN (
        'simple_email', 'email_attachment', 'linked_email',
        'simple_website', 'authenticated_website'));
