-- Migration: 035_smoke_rpc_user_id.up.sql
-- Service: xstockstrat-config
-- Seeds smoke.rpc.user_id (feature 280, smoke-check-runtime) for staging + production.
--
-- Must apply after 034 (feature 264); `key` is the full dotted string and value_type must be 'string'.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('smoke', 'smoke.rpc.user_id', 'string', '',
   'Identity of the smoke RPC user; empty = RPC checks ERROR.',
   '', 'xstockstrat-smoke', 'staging', NULL),
  ('smoke', 'smoke.rpc.user_id', 'string', '',
   'Identity of the smoke RPC user; empty = RPC checks ERROR.',
   '', 'xstockstrat-smoke', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
