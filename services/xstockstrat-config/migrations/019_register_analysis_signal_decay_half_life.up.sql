-- Migration: 019_register_analysis_signal_decay_half_life.up.sql
-- Service: xstockstrat-config
-- Feature 161: register analysis.scoring.signal_decay_half_life_hours as a config key so it appears
-- in config-ui with operator guidance and is cleanly settable via SetConfig. Completes feature 022's
-- deferred seed-migration follow-on. value_type='float' scalar; server-enforced bounds [0, 8760]
-- live in the config service's SCALAR_BOUNDS_REGISTRY (SQL has no bounds column). Global scope, both
-- environments. Default 24.0 must match the analysis reader's get_float_present default.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'scoring.signal_decay_half_life_hours', 'float', '24.0', FALSE,
   'Exponential age-decay half-life in hours for a signal''s contribution to the Opportunities '
   || 'queue signal ranking (feature 022). 0 disables decay (multiplier stays 1.0); larger values '
   || 'decay more slowly. Bounds [0, 8760] (8760h = 1 year, a unit-typo guard) are enforced '
   || 'server-side at SetConfig. Typical: 24 (one day).',
   '24.0', 'xstockstrat-analysis', 'staging', NULL),
  ('analysis', 'scoring.signal_decay_half_life_hours', 'float', '24.0', FALSE,
   'Exponential age-decay half-life in hours for a signal''s contribution to the Opportunities '
   || 'queue signal ranking (feature 022). 0 disables decay (multiplier stays 1.0); larger values '
   || 'decay more slowly. Bounds [0, 8760] (8760h = 1 year, a unit-typo guard) are enforced '
   || 'server-side at SetConfig. Typical: 24 (one day).',
   '24.0', 'xstockstrat-analysis', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
