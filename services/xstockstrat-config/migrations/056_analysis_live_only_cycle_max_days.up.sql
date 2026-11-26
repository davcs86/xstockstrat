-- Migration: 056_analysis_live_only_cycle_max_days.up.sql
-- Service: xstockstrat-config, feature opportunity-live-only-rotation. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('analysis', 'opportunity.live_only_cycle_max_days', 'int', '3',
   'Live-only opportunity rotation (feature 366): a full rotation of the live-only pool should finish within this many days, and a carried live-only row older than this is dropped. Fresh live-only rows are stamped valid_until = computed_at + this many days. Bounds [1,30]. A value of 0 or less reads as 3.',
   '3', 'xstockstrat-analysis', 'system:config-migration-feature-opportunity-live-only-rotation', 'staging', NULL),
  ('analysis', 'opportunity.live_only_cycle_max_days', 'int', '3',
   'Live-only opportunity rotation (feature 366): a full rotation of the live-only pool should finish within this many days, and a carried live-only row older than this is dropped. Fresh live-only rows are stamped valid_until = computed_at + this many days. Bounds [1,30]. A value of 0 or less reads as 3.',
   '3', 'xstockstrat-analysis', 'system:config-migration-feature-opportunity-live-only-rotation', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
