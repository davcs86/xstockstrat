-- Migration: 059_trading_broker_paper_per_environment.down.sql
-- Service: xstockstrat-config, feature 321. A row an operator has changed is never deleted.

DELETE FROM config.config_values
WHERE namespace = 'trading'
  AND key = 'broker.paper'
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-321'
  AND ((environment = 'staging' AND value_data = 'true') OR (environment = 'production' AND value_data = 'false'));
