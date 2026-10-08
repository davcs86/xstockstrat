-- Migration: 013_signal_ownership_templates.down.sql
-- Refuses a lossy rollback: N-1 keys sources and dedup claims by slug alone, so multi-owner rows must go first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ingest' AND table_name = 'signal_sources' AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1 FROM ingest.signal_sources GROUP BY slug HAVING count(DISTINCT user_id) > 1
  ) THEN
    RAISE EXCEPTION 'migration 013 down: a signal_sources slug has more than one owner; rollback would lose rows';
  END IF;
  IF to_regclass('ingest.signal_dedup_claims') IS NOT NULL AND EXISTS (
    SELECT 1 FROM ingest.signal_dedup_claims
     GROUP BY source, symbol, direction HAVING count(DISTINCT user_id) > 1
  ) THEN
    RAISE EXCEPTION 'migration 013 down: a signal_dedup_claims (source, symbol, direction) has more than one owner';
  END IF;
END $$;

DROP TRIGGER IF EXISTS newsletter_signals_n1_owner_fill ON ingest.newsletter_signals;
DROP FUNCTION IF EXISTS ingest.n1_owner_fill_signals();

DROP TABLE IF EXISTS ingest.source_templates;
DROP TABLE IF EXISTS ingest.signal_dedup_claims;

DROP INDEX IF EXISTS ingest.idx_newsletter_signals_owner_ingested;

ALTER TABLE ingest.signal_sources
    DROP COLUMN IF EXISTS origin_template_version,
    DROP COLUMN IF EXISTS origin_template_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ingest' AND table_name = 'signal_sources' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_pkey;
    ALTER TABLE ingest.signal_sources ADD PRIMARY KEY (slug);
  END IF;
END $$;

ALTER TABLE ingest.signal_sources DROP COLUMN IF EXISTS user_id;
ALTER TABLE ingest.newsletter_signals DROP COLUMN IF EXISTS user_id;
