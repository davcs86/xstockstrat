-- Restore the placeholder reference row removed by 009 (feature 076).
-- Note: this restores the PLACEHOLDER only, never a real credential.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode, is_secret)
VALUES
  ('marketdata', 'secret.marketdata.fmp.api_key', 'string', 'secret://marketdata/fmp-api-key',
   'FMP API key (secret reference — resolved at deploy, never plaintext)',
   'secret://marketdata/fmp-api-key', 'xstockstrat-marketdata', 'dev', 'all', TRUE),
  ('marketdata', 'secret.marketdata.fmp.api_key', 'string', 'secret://marketdata/fmp-api-key',
   'FMP API key (secret reference — resolved at deploy, never plaintext)',
   'secret://marketdata/fmp-api-key', 'xstockstrat-marketdata', 'production', 'all', TRUE)
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
