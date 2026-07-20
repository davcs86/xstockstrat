-- 007_signal_source_type_mediated.down.sql
-- Restore the migration-006 CHECK (programmatic types + 'derived').
-- Any rows with a mediated source_type must be removed first or the ADD fails.
ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check;
ALTER TABLE ingest.signal_sources ADD CONSTRAINT signal_sources_source_type_check
    CHECK (source_type IN (
        'simple_email', 'email_attachment', 'linked_email',
        'simple_website', 'authenticated_website',
        'derived'));
