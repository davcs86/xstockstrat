-- Migration: 020_remove_analysis_signal_source_weights.down.sql
-- Service: xstockstrat-config
-- Feature 161: restore the dead analysis.signals.source_weights key to its pre-deletion state — both
-- environment rows, post-147 column layout (environment 'staging'/'production', user_id NULL, no
-- trading_mode column), value_type='string', value_data='{}', and the feature-134 016-reworded
-- "SUPERSEDED" description (that was the live description at deletion time, not the original 003 text).
-- NOTE: this hardcoded restore clobbers any live operator edit to value_data (inherent to a
-- hardcoded down-migration). Nothing reads this key, so the runtime impact is nil.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'signals.source_weights', 'string', '{}', FALSE,
   'SUPERSEDED (feature 134): the per-source reliability weight now lives on '
   || 'ingest.SignalSource.reliability_weight (validated reject-at-write in [0.0, 1.0]) '
   || 'and is read by analysis via ListSignalSources. This key is retained for history '
   || 'but is no longer read by any service — editing it has no effect.',
   '{}', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'signals.source_weights', 'string', '{}', FALSE,
   'SUPERSEDED (feature 134): the per-source reliability weight now lives on '
   || 'ingest.SignalSource.reliability_weight (validated reject-at-write in [0.0, 1.0]) '
   || 'and is read by analysis via ListSignalSources. This key is retained for history '
   || 'but is no longer read by any service — editing it has no effect.',
   '{}', 'xstockstrat-analysis', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
