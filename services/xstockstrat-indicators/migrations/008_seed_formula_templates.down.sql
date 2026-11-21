-- Migration: 008_seed_formula_templates.down.sql
-- Service: xstockstrat-indicators
-- feature 335: run the analysis seed_strategy_templates down before this one (its rows reference these ids).

DELETE FROM indicators.formula_templates
 WHERE template_id IN (
    'tpl-volatility_trailing_stop_direction',
    'tpl-bollinger_squeeze_percentile',
    'tpl-fundamentals_value_quality_composite_template',
    'tpl-sma_trend_slope_fractional',
    'tpl-momentum_quality_clenow',
    'tpl-kaufman_efficiency_ratio',
    'tpl-mean_reversion_z_score',
    'tpl-rolling_zscore_v2',
    'tpl-kaufman_efficiency_ratio_v2'
   )
   AND version = 1 AND retired_at IS NULL AND created_by = 'system';
