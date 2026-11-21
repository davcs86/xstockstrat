-- ingest 016 seed_source_templates (feature 335: AC-11, AC-12, AC-18, AC-24, AC-40): run by
-- migration-rerun.py after pass 3. The shared fixture already holds a fundamentals source, so every
-- slug state is built here inside its own BEGIN ... ROLLBACK.

-- Post-state: the live system template rows are exactly the four seeded ids at version 1.
DO $$
DECLARE actual TEXT[];
BEGIN
  SELECT array_agg(template_id ORDER BY template_id) INTO actual
    FROM ingest.source_templates
   WHERE created_by = 'system' AND retired_at IS NULL AND version = 1;
  IF actual IS DISTINCT FROM ARRAY['tpl-prnewswire_releases', 'tpl-robinhood_snacks',
                                   'tpl-sec_edgar_8k', 'tpl-sec_edgar_form4'] THEN
    RAISE EXCEPTION 'ingest 016: seeded source templates differ: %', actual;
  END IF;
END $$;

-- AC-11: with no holder of the slug, the seed creates the system fundamentals source.
BEGIN;
DELETE FROM ingest.signal_sources WHERE slug = 'fundamentals';
\ir ../../services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql
DO $$
BEGIN
  IF (SELECT count(*) FROM ingest.signal_sources WHERE slug = 'fundamentals') <> 1 THEN
    RAISE EXCEPTION 'AC-11: expected exactly one fundamentals source';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ingest.signal_sources
                  WHERE slug = 'fundamentals' AND user_id = 'system' AND source_type = 'derived'
                    AND display_name = 'Fundamentals Signal Producer'
                    AND extractor_module = 'app.extractors.noop' AND active
                    AND reliability_weight = 1.0 AND credentials_ref IS NULL AND config_json IS NULL) THEN
    RAISE EXCEPTION 'AC-11: the seeded fundamentals source does not match the producer registration';
  END IF;
END $$;
ROLLBACK;

-- AC-12: an existing system row is never overwritten.
BEGIN;
DELETE FROM ingest.signal_sources WHERE slug = 'fundamentals';
INSERT INTO ingest.signal_sources
  (user_id, slug, display_name, source_type, extractor_module, active, reliability_weight)
VALUES ('system', 'fundamentals', 'Fundamentals Signal Producer', 'derived', 'app.extractors.noop', TRUE, 0.4);
\ir ../../services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql
DO $$
BEGIN
  IF (SELECT reliability_weight FROM ingest.signal_sources
       WHERE slug = 'fundamentals' AND user_id = 'system') IS DISTINCT FROM 0.4 THEN
    RAISE EXCEPTION 'AC-12: the seed overwrote an existing system fundamentals source';
  END IF;
END $$;
ROLLBACK;

-- AC-40: a user-held slug gains no system holder.
BEGIN;
DELETE FROM ingest.signal_sources WHERE slug = 'fundamentals';
INSERT INTO ingest.signal_sources
  (user_id, slug, display_name, source_type, extractor_module, active, reliability_weight)
VALUES ('u-1', 'fundamentals', 'Mine', 'derived', 'app.extractors.noop', TRUE, 1.0);
\ir ../../services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ingest.signal_sources WHERE slug = 'fundamentals' AND user_id = 'system') THEN
    RAISE EXCEPTION 'AC-40: the seed added a system holder to a user-held slug';
  END IF;
END $$;
ROLLBACK;

-- AC-24: a replay does not un-retire a row.
BEGIN;
UPDATE ingest.source_templates SET retired_at = NOW() WHERE template_id = 'tpl-robinhood_snacks';
\ir ../../services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql
DO $$
BEGIN
  IF (SELECT count(*) FROM ingest.source_templates WHERE created_by = 'system') <> 4 THEN
    RAISE EXCEPTION 'AC-24: replay changed the seeded row count';
  END IF;
  IF (SELECT retired_at FROM ingest.source_templates WHERE template_id = 'tpl-robinhood_snacks') IS NULL THEN
    RAISE EXCEPTION 'AC-24: replay un-retired a row';
  END IF;
END $$;
ROLLBACK;

-- AC-18: the down removes the seeded templates and leaves the fundamentals source in place.
BEGIN;
DELETE FROM ingest.signal_sources WHERE slug = 'fundamentals';
\ir ../../services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql
\ir ../../services/xstockstrat-ingest/migrations/016_seed_source_templates.down.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ingest.source_templates WHERE created_by = 'system') THEN
    RAISE EXCEPTION 'AC-18: the down left a seeded source template';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ingest.signal_sources WHERE slug = 'fundamentals' AND user_id = 'system') THEN
    RAISE EXCEPTION 'AC-18: the down removed the fundamentals source';
  END IF;
END $$;
ROLLBACK;
