-- indicators 007 (AC-15, AC-22): run by migration-rerun.sh after pass 1 + replay, over fixtures-pre-224.sql.

DO $$
DECLARE
  missing BIGINT;
  changed BIGINT;
BEGIN
  SELECT count(*) INTO missing
    FROM fixture_pre224.formulas f
    LEFT JOIN indicators.formulas c USING (formula_id)
   WHERE c.formula_id IS NULL;
  IF missing <> 0 OR (SELECT count(*) FROM fixture_pre224.formulas) <> 8 THEN
    RAISE EXCEPTION 'AC-22: % of the 8 fixture formulas were deleted', missing;
  END IF;

  SELECT count(*) INTO changed
    FROM fixture_pre224.formulas f
    JOIN indicators.formulas c USING (formula_id)
   WHERE c.source IS DISTINCT FROM f.source OR c.author IS DISTINCT FROM f.author;
  IF changed <> 0 THEN
    RAISE EXCEPTION 'AC-22: % fixture formulas changed source/author', changed;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM indicators.formulas WHERE is_public) THEN
    RAISE EXCEPTION 'AC-22: % formulas still have is_public = true',
      (SELECT count(*) FROM indicators.formulas WHERE is_public);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'indicators' AND tablename = 'formulas' AND indexdef LIKE '%(is_public)%'
  ) THEN
    RAISE EXCEPTION 'indicators 007: an is_public index on indicators.formulas survived';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('indicators.formula_templates') IS NULL THEN
    RAISE EXCEPTION 'AC-15: indicators.formula_templates does not exist';
  END IF;
  IF EXISTS (SELECT 1 FROM indicators.formula_templates) THEN
    RAISE EXCEPTION 'AC-15: indicators.formula_templates has seed rows';
  END IF;
END $$;
