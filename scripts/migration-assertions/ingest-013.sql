-- ingest 013 (AC-15, AC-27, N-1 trigger): run by migration-rerun.sh after pass 1 + replay, over
-- fixtures-pre-224.sql. The trigger probes run inside a transaction that is rolled back.
SELECT set_config('migration_assert.seed_user_id', :'seed_user_id', false);

DO $$
DECLARE
  seed TEXT := current_setting('migration_assert.seed_user_id');
  bad  BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM ingest.signal_sources
   WHERE user_id IS DISTINCT FROM CASE WHEN source_type = 'derived' THEN 'system' ELSE seed END;
  IF bad <> 0 THEN
    RAISE EXCEPTION 'AC-27: % signal_sources rows have the wrong backfilled owner', bad;
  END IF;
  IF (SELECT user_id FROM ingest.signal_sources WHERE slug = 'fundamentals') IS DISTINCT FROM 'system'
     OR (SELECT count(*) FROM ingest.signal_sources
          WHERE slug IN ('fixture-newsletter', 'fixture-website') AND user_id = seed) <> 2 THEN
    RAISE EXCEPTION 'AC-27: fixture sources are not owned by system (fundamentals) / the seed user (others)';
  END IF;

  SELECT count(*) INTO bad
    FROM ingest.newsletter_signals n
   WHERE n.id BETWEEN 822400001 AND 822400120
     AND n.user_id IS DISTINCT FROM CASE WHEN n.source = 'fundamentals' THEN 'system' ELSE seed END;
  IF bad <> 0 OR (SELECT count(*) FROM ingest.newsletter_signals
                   WHERE id BETWEEN 822400001 AND 822400120) <> 120 THEN
    RAISE EXCEPTION 'AC-27: % of the 120 fixture signals have the wrong owner (or rows are missing)', bad;
  END IF;
END $$;

DO $$
DECLARE
  pk_cols TEXT;
BEGIN
  SELECT string_agg(a.attname::text, ',' ORDER BY k.ord) INTO pk_cols
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k (attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = 'ingest.signal_sources'::regclass AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM 'user_id,slug' THEN
    RAISE EXCEPTION 'ingest 013: signal_sources PK is (%), expected (user_id,slug)', pk_cols;
  END IF;
END $$;

DO $$
DECLARE
  claims     BIGINT;
  mismatched BIGINT;
BEGIN
  SELECT count(*) INTO claims FROM ingest.signal_dedup_claims WHERE signal_id BETWEEN 822400001 AND 822400120;
  SELECT count(*) INTO mismatched
    FROM ingest.signal_dedup_claims c
    LEFT JOIN ingest.newsletter_signals n ON n.id = c.signal_id
   WHERE n.id IS NULL OR c.user_id IS DISTINCT FROM n.user_id;
  IF claims <> 120 OR mismatched <> 0 THEN
    RAISE EXCEPTION 'ingest 013: % fixture dedup claims (expected 120), % with an owner unlike their signal',
      claims, mismatched;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('ingest.source_templates') IS NULL THEN
    RAISE EXCEPTION 'AC-15: ingest.source_templates does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM ingest.source_templates) THEN
    RAISE EXCEPTION 'AC-15: ingest.source_templates has seed rows';
  END IF;
END $$;

BEGIN;

-- N-1 writer shape: no user_id column. The trigger must fill the slug's unique holder.
INSERT INTO ingest.newsletter_signals (id, source, symbol, direction, valid_from)
VALUES (822400901, 'fixture-website', 'N1FILL', 'buy', NOW());

DO $$
DECLARE
  seed TEXT := current_setting('migration_assert.seed_user_id');
BEGIN
  IF (SELECT user_id FROM ingest.newsletter_signals WHERE id = 822400901) IS DISTINCT FROM seed THEN
    RAISE EXCEPTION 'N-1 trigger: unique-holder insert was not filled with the holder';
  END IF;
END $$;

-- A second holder of the slug makes the owner ambiguous: the trigger must raise, never guess.
INSERT INTO ingest.signal_sources (user_id, slug, display_name, source_type, extractor_module)
VALUES ('user-b@example.test', 'fixture-website', 'Fixture Website (B)', 'simple_website', 'app.extractors.noop');

DO $$
DECLARE
  msg    TEXT;
  raised BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO ingest.newsletter_signals (id, source, symbol, direction, valid_from)
    VALUES (822400902, 'fixture-website', 'N1AMBIG', 'buy', NOW());
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    IF msg NOT LIKE 'n1_owner_fill:%' THEN
      RAISE;
    END IF;
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'N-1 trigger: ambiguous-owner insert did not raise';
  END IF;
END $$;

ROLLBACK;
