-- ingest 017 signal_source_extraction_instructions (feature 355: AC-16): run by migration-rerun.py
-- after pass 3. The replay and the down each run inside their own BEGIN ... ROLLBACK.

-- Post-state: the column is defaulted NOT NULL text, and the four system templates carry prose at version 1.
DO $$
DECLARE seeded INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'ingest' AND table_name = 'signal_sources'
                    AND column_name = 'extraction_instructions' AND data_type = 'text'
                    AND is_nullable = 'NO' AND column_default = '''''::text') THEN
    RAISE EXCEPTION 'ingest 017: signal_sources.extraction_instructions is not NOT NULL text DEFAULT ''''';
  END IF;
  SELECT count(*) INTO seeded
    FROM ingest.source_templates
   WHERE created_by = 'system' AND version = 1
     AND btrim(coalesce(payload->>'extraction_instructions', '')) <> '';
  IF seeded <> 4 THEN
    RAISE EXCEPTION 'ingest 017: expected 4 system templates with extraction_instructions at version 1, got %', seeded;
  END IF;
END $$;

-- A replay of the up changes no template row.
BEGIN;
CREATE TEMP TABLE ingest_017_before ON COMMIT DROP AS
  SELECT template_id, payload, updated_at FROM ingest.source_templates;
\ir ../../services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.up.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ingest.source_templates t JOIN ingest_017_before b USING (template_id)
              WHERE t.payload IS DISTINCT FROM b.payload OR t.updated_at IS DISTINCT FROM b.updated_at) THEN
    RAISE EXCEPTION 'ingest 017: replaying the up changed a template payload or updated_at';
  END IF;
END $$;
ROLLBACK;

-- The down removes the key and the column and leaves the fundamentals source in place.
BEGIN;
\ir ../../services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.down.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ingest.source_templates
              WHERE created_by = 'system' AND payload ? 'extraction_instructions') THEN
    RAISE EXCEPTION 'ingest 017: the down left extraction_instructions on a system template';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'ingest' AND table_name = 'signal_sources'
                AND column_name = 'extraction_instructions') THEN
    RAISE EXCEPTION 'ingest 017: the down left the extraction_instructions column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ingest.signal_sources WHERE slug = 'fundamentals') THEN
    RAISE EXCEPTION 'ingest 017: the down removed the fundamentals source';
  END IF;
END $$;
ROLLBACK;
