-- 011_signal_source_type_mcp_client.down.sql
-- Service: xstockstrat-ingest
-- Reverse 011: restore the 11-value CHECK from 007 (drops 'mcp_client'). Safe only when no row still
-- carries source_type = 'mcp_client' (a live mcp_client source must be deregistered first).
ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check;
ALTER TABLE ingest.signal_sources ADD CONSTRAINT signal_sources_source_type_check
    CHECK (source_type IN (
        'simple_email', 'email_attachment', 'linked_email',
        'simple_website', 'authenticated_website',
        'mediated_simple_email', 'mediated_email_attachment', 'mediated_linked_email',
        'mediated_simple_website', 'mediated_authenticated_website',
        'derived'));
