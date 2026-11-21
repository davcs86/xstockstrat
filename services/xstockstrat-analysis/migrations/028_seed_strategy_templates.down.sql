-- Migration: 028_seed_strategy_templates.down.sql
-- Service: xstockstrat-analysis
-- feature 335: runs before the indicators seed_formula_templates down (these rows reference its ids).

DELETE FROM analysis.strategy_templates
 WHERE template_id IN (
    'tpl-dip_buyer_vol_stop',
    'tpl-squeeze_breakout_trend',
    'tpl-fundamentals_macd_blend',
    'tpl-dip_buyer_vol_stop_m25',
    'tpl-dip_buyer_vol_stop_m35',
    'tpl-dip_buyer_regime_filtered',
    'tpl-dip_buyer_market_regime_voo',
    'tpl-squeeze_macd_mq',
    'tpl-squeeze_mq_confirmed',
    'tpl-zscore_trend_filtered',
    'tpl-clenow_momentum_regime',
    'tpl-range_mean_reversion_v2',
    'tpl-quality_dip_buyer',
    'tpl-golden_cross_conviction'
   )
   AND version = 1 AND retired_at IS NULL AND created_by = 'system';
