-- Migration: 059_trading_broker_paper_per_environment.up.sql
-- Service: xstockstrat-config, feature 321. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('trading', 'broker.paper', 'bool', 'true',
   'Paper or live for this deployment: true stamps new orders and registers new broker accounts as paper, false as live. Seeded per environment (staging true, production false); with no row trading resolves paper unless APPLICATION_ENV is production. Read live. Accounts already registered keep routing by their own stored mode, so changing this value does not re-route them.',
   'true', 'xstockstrat-trading', 'system:config-migration-feature-321', 'staging', NULL),
  ('trading', 'broker.paper', 'bool', 'false',
   'Paper or live for this deployment: true stamps new orders and registers new broker accounts as paper, false as live. Seeded per environment (staging true, production false); with no row trading resolves paper unless APPLICATION_ENV is production. Read live. Accounts already registered keep routing by their own stored mode, so changing this value does not re-route them.',
   'false', 'xstockstrat-trading', 'system:config-migration-feature-321', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
