UPDATE config.config_values
SET key = namespace || '.' || key
WHERE key NOT LIKE namespace || '.%'
  AND is_secret = false
  AND namespace IN ('platform', 'trading', 'portfolio', 'marketdata');

UPDATE config.config_values
SET key = namespace || '.' || key
WHERE namespace = 'indicators'
  AND key IN ('sandbox.timeout_ms')
  AND is_secret = false;
