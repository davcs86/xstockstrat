-- Migration: 036_smoke_writes_enabled.up.sql
-- Service: xstockstrat-config
-- Seeds smoke.writes.enabled (feature 280, smoke-check-runtime, phase 2) for staging + production.
--
-- Must apply after 035; value_type must be 'bool' (the smoke watcher reads bool_val) and the default stays false.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('smoke', 'smoke.writes.enabled', 'bool', 'false',
   'Kill switch for smoke phase-2 scoped writes; false refuses every write before a channel opens.',
   'false', 'xstockstrat-smoke', 'staging', NULL),
  ('smoke', 'smoke.writes.enabled', 'bool', 'false',
   'Kill switch for smoke phase-2 scoped writes; false refuses every write before a channel opens.',
   'false', 'xstockstrat-smoke', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
