-- indicators 008 seed_formula_templates (feature 335: AC-1, AC-9, AC-23, AC-24, AC-39): run by
-- migration-rerun.py after pass 3. Each state is built inside its own BEGIN ... ROLLBACK.

-- AC-1: the live system rows are exactly the nine seeded ids, each at version 1.
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'tpl-volatility_trailing_stop_direction', 'tpl-bollinger_squeeze_percentile',
    'tpl-fundamentals_value_quality_composite_template', 'tpl-sma_trend_slope_fractional',
    'tpl-momentum_quality_clenow', 'tpl-kaufman_efficiency_ratio', 'tpl-mean_reversion_z_score',
    'tpl-rolling_zscore_v2', 'tpl-kaufman_efficiency_ratio_v2'];
  actual TEXT[];
BEGIN
  SELECT array_agg(template_id ORDER BY template_id) INTO actual
    FROM indicators.formula_templates
   WHERE created_by = 'system' AND retired_at IS NULL AND version = 1;
  IF actual IS DISTINCT FROM (SELECT array_agg(e ORDER BY e) FROM unnest(expected) AS e) THEN
    RAISE EXCEPTION 'AC-1: seeded formula templates differ: %', actual;
  END IF;
END $$;

-- AC-23: a replay keeps a row a later migration moved to version 2.
BEGIN;
UPDATE indicators.formula_templates SET version = 2 WHERE template_id = 'tpl-kaufman_efficiency_ratio';
\ir ../../services/xstockstrat-indicators/migrations/008_seed_formula_templates.up.sql
DO $$
BEGIN
  IF (SELECT count(*) FROM indicators.formula_templates WHERE created_by = 'system') <> 9 THEN
    RAISE EXCEPTION 'AC-23: replay changed the seeded row count';
  END IF;
  IF (SELECT version FROM indicators.formula_templates
       WHERE template_id = 'tpl-kaufman_efficiency_ratio') <> 2 THEN
    RAISE EXCEPTION 'AC-23: replay reset a version-2 row';
  END IF;
END $$;
ROLLBACK;

-- AC-24: a replay does not un-retire a row.
BEGIN;
UPDATE indicators.formula_templates SET retired_at = NOW() WHERE template_id = 'tpl-mean_reversion_z_score';
\ir ../../services/xstockstrat-indicators/migrations/008_seed_formula_templates.up.sql
DO $$
BEGIN
  IF (SELECT count(*) FROM indicators.formula_templates WHERE created_by = 'system') <> 9 THEN
    RAISE EXCEPTION 'AC-24: replay changed the seeded row count';
  END IF;
  IF (SELECT retired_at FROM indicators.formula_templates
       WHERE template_id = 'tpl-mean_reversion_z_score') IS NULL THEN
    RAISE EXCEPTION 'AC-24: replay un-retired a row';
  END IF;
END $$;
ROLLBACK;

-- AC-9: the down removes only the seeded rows.
BEGIN;
INSERT INTO indicators.formula_templates (template_id, name, description, payload, created_by)
VALUES ('tpl-admin-custom', 'Admin custom', '', '{"name": "Admin custom", "source": "result = 1"}'::jsonb, 'admin1');
\ir ../../services/xstockstrat-indicators/migrations/008_seed_formula_templates.down.sql
DO $$
BEGIN
  IF (SELECT array_agg(template_id) FROM indicators.formula_templates)
     IS DISTINCT FROM ARRAY['tpl-admin-custom'] THEN
    RAISE EXCEPTION 'AC-9: the down did not leave exactly the admin-authored row';
  END IF;
END $$;
ROLLBACK;

-- AC-39: the up refuses a seeded id held by a non-system row.
BEGIN;
UPDATE indicators.formula_templates SET created_by = 'admin1' WHERE template_id = 'tpl-kaufman_efficiency_ratio';
SAVEPOINT collide;
\set ON_ERROR_STOP off
\ir ../../services/xstockstrat-indicators/migrations/008_seed_formula_templates.up.sql
\set seed_error :'LAST_ERROR_MESSAGE'
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT collide;
SELECT :'seed_error' LIKE '%held by a non-system row%tpl-kaufman_efficiency_ratio%' AS refused \gset
\if :refused
\else
  \echo 'AC-39: the seed did not refuse a template_id held by a non-system row'
  SELECT 1 / 0;
\endif
ROLLBACK;
