-- 029 shape: namespace-guarded prefix heal, then a value-only UPDATE.
UPDATE config.config_values
SET key = namespace || '.' || key
WHERE key NOT LIKE namespace || '.%'
  AND is_secret = false
  AND namespace IN ('platform', 'trading', 'portfolio', 'marketdata');

UPDATE config.config_values
SET value_data = 'true'
WHERE namespace = 'trading'
  AND key = 'trading.risk.bracket_orders_enabled'
  AND environment = 'production'
  AND user_id IS NULL;
