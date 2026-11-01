INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('marketdata', 'marketdata.alpaca.api_key', 'string', 'SECRETVALUE-JOIN-913', TRUE, 'secret row', '', 'xstockstrat-marketdata', 'staging', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
