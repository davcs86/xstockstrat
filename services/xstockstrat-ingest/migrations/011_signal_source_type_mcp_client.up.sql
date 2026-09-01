-- 011_signal_source_type_mcp_client.up.sql
-- Service: xstockstrat-ingest
-- Feature 166 (mcp-client-signal-source): add the 'mcp_client' server-side source type to the
-- signal_sources.source_type CHECK. Additive only — widening a CHECK invalidates no existing rows.
-- DROP + re-ADD re-listing ALL values (never an append) so the constraint is the single source of
-- truth (fails.md signal-source-registry). The validator branch that accepts 'mcp_client' lands in
-- the SAME feature branch (app/repositories/signal_sources.py) — a CHECK-only add would leave the
-- type validator-rejected, a validator-only add would leave it CHECK-rejected at INSERT.
ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_source_type_check;
ALTER TABLE ingest.signal_sources ADD CONSTRAINT signal_sources_source_type_check
    CHECK (source_type IN (
        'simple_email', 'email_attachment', 'linked_email',
        'simple_website', 'authenticated_website',
        'mediated_simple_email', 'mediated_email_attachment', 'mediated_linked_email',
        'mediated_simple_website', 'mediated_authenticated_website',
        'derived', 'mcp_client'));
