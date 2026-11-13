-- Run: psql "<staging uri>?sslmode=require" -v ON_ERROR_STOP=1 -qAt -v owner=<operator user id> -f scripts/testdata/seed-templates-staging-export.sql > scripts/testdata/seed-templates-staging-2026-11-12.json
-- Read-only parity reference for the seed-template migrations; commit the output unedited.
BEGIN TRANSACTION READ ONLY;

SELECT jsonb_pretty(jsonb_build_object(
  'exported_at', now(),
  'strategies', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'strategy_id', s.strategy_id,
             'display_name', s.display_name,
             'active', s.active,
             'live_enabled', s.live_enabled,
             'definition_json', s.definition_json
           ) ORDER BY s.strategy_id), '[]'::jsonb)
      FROM analysis.strategies s
     WHERE s.user_id = :'owner'
       AND s.strategy_id IN (
             'dip_buyer_vol_stop', 'squeeze_breakout_trend', 'fundamentals_macd_blend',
             'dip_buyer_vol_stop_m25', 'dip_buyer_vol_stop_m35', 'dip_buyer_regime_filtered',
             'dip_buyer_market_regime_voo', 'squeeze_macd_mq', 'squeeze_mq_confirmed',
             'zscore_trend_filtered', 'clenow_momentum_regime', 'range_mean_reversion_v2',
             'quality_dip_buyer', 'golden_cross_conviction')
  ),
  'formulas', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'formula_id', f.formula_id,
             'name', f.name,
             'author', f.author,
             'source_md5', md5(f.source),
             'description_md5', md5(f.description),
             'parameters', f.parameters,
             'outputs', f.outputs,
             'warmup_period', f.warmup_period,
             'fundamental_inputs', f.fundamental_inputs,
             'input_schema', f.input_schema
           ) ORDER BY f.name), '[]'::jsonb)
      FROM indicators.formulas f
     WHERE (f.author = :'owner'
            AND f.deleted_at IS NULL
            AND f.name IN (
                  'Volatility Trailing Stop Direction', 'Bollinger Squeeze Percentile',
                  'SMA Trend Slope (fractional)', 'Momentum Quality (Clenow)',
                  'Kaufman Efficiency Ratio', 'Mean-Reversion Z-Score',
                  'rolling_zscore_v2', 'kaufman_efficiency_ratio_v2'))
        OR f.formula_id::text = 'd1ff5e6b-6d9c-589d-b95e-defd862c702b'
        OR f.formula_id::text IN (
             SELECT c ->> 'formula_id'
               FROM analysis.strategies s2,
                    jsonb_array_elements(s2.definition_json -> 'components') AS c
              WHERE s2.user_id = :'owner'
                AND s2.strategy_id IN (
                      'dip_buyer_vol_stop', 'squeeze_breakout_trend', 'fundamentals_macd_blend',
                      'dip_buyer_vol_stop_m25', 'dip_buyer_vol_stop_m35', 'dip_buyer_regime_filtered',
                      'dip_buyer_market_regime_voo', 'squeeze_macd_mq', 'squeeze_mq_confirmed',
                      'zscore_trend_filtered', 'clenow_momentum_regime', 'range_mean_reversion_v2',
                      'quality_dip_buyer', 'golden_cross_conviction')
                AND c ->> 'formula_id' IS NOT NULL)
  ),
  'sources', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'slug', g.slug,
             'display_name', g.display_name,
             'source_type', g.source_type,
             'extractor_module', g.extractor_module,
             'reliability_weight', g.reliability_weight,
             'config_json', g.config_json
           ) ORDER BY g.slug), '[]'::jsonb)
      FROM ingest.signal_sources g
     WHERE g.user_id = :'owner'
       AND g.slug IN ('sec_edgar_8k', 'sec_edgar_form4', 'prnewswire_releases', 'robinhood_snacks')
  )
));

ROLLBACK;
