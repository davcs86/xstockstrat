-- analysis 028 seed_strategy_templates (feature 335: AC-3, AC-24, AC-25): run by migration-rerun.py
-- after pass 3. Each state is built inside its own BEGIN ... ROLLBACK.

-- AC-3: the live system rows are exactly the 14 seeded ids at version 1; none of the excluded ids exists.
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'tpl-dip_buyer_vol_stop', 'tpl-squeeze_breakout_trend', 'tpl-fundamentals_macd_blend',
    'tpl-dip_buyer_vol_stop_m25', 'tpl-dip_buyer_vol_stop_m35', 'tpl-dip_buyer_regime_filtered',
    'tpl-dip_buyer_market_regime_voo', 'tpl-squeeze_macd_mq', 'tpl-squeeze_mq_confirmed',
    'tpl-zscore_trend_filtered', 'tpl-clenow_momentum_regime', 'tpl-range_mean_reversion_v2',
    'tpl-quality_dip_buyer', 'tpl-golden_cross_conviction'];
  actual TEXT[];
BEGIN
  SELECT array_agg(template_id ORDER BY template_id) INTO actual
    FROM analysis.strategy_templates
   WHERE created_by = 'system' AND retired_at IS NULL AND version = 1;
  IF actual IS DISTINCT FROM (SELECT array_agg(e ORDER BY e) FROM unnest(expected) AS e) THEN
    RAISE EXCEPTION 'AC-3: seeded strategy templates differ: %', actual;
  END IF;
  IF EXISTS (SELECT 1 FROM analysis.strategy_templates WHERE template_id IN (
       'tpl-zz_fscore_probe', 'tpl-dbg_regime_voo_inverted', 'tpl-diag_formula_probe', 'tpl-jjjjjjj',
       'tpl-bbbb', 'tpl-aaaa', 'tpl-rsi20', 'tpl-range_mean_reversion', 'tpl-range_mean_reversion_v3')) THEN
    RAISE EXCEPTION 'AC-3: an excluded strategy was seeded as a template';
  END IF;
END $$;

-- AC-24: a replay does not un-retire a row.
BEGIN;
UPDATE analysis.strategy_templates SET retired_at = NOW() WHERE template_id = 'tpl-golden_cross_conviction';
\ir ../../services/xstockstrat-analysis/migrations/028_seed_strategy_templates.up.sql
DO $$
BEGIN
  IF (SELECT count(*) FROM analysis.strategy_templates WHERE created_by = 'system') <> 14 THEN
    RAISE EXCEPTION 'AC-24: replay changed the seeded row count';
  END IF;
  IF (SELECT retired_at FROM analysis.strategy_templates
       WHERE template_id = 'tpl-golden_cross_conviction') IS NULL THEN
    RAISE EXCEPTION 'AC-24: replay un-retired a row';
  END IF;
END $$;
ROLLBACK;

-- AC-25: the down keeps a seeded row that is no longer at version 1.
BEGIN;
UPDATE analysis.strategy_templates SET version = 2 WHERE template_id = 'tpl-quality_dip_buyer';
\ir ../../services/xstockstrat-analysis/migrations/028_seed_strategy_templates.down.sql
DO $$
BEGIN
  IF (SELECT array_agg(template_id || ':' || version) FROM analysis.strategy_templates)
     IS DISTINCT FROM ARRAY['tpl-quality_dip_buyer:2'] THEN
    RAISE EXCEPTION 'AC-25: the down did not leave exactly the version-2 row';
  END IF;
END $$;
ROLLBACK;
