-- Migration: 052_alpaca_adaptive_rate_limit_keys.down.sql
-- Service: xstockstrat-config, feature alpaca-adaptive-rate-limit. A row an operator has changed is never deleted or rewritten; the outer parentheses are load-bearing.

DELETE FROM config.config_values
WHERE environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-alpaca-adaptive-rate-limit'
  AND value_data = 'true'
  AND ((namespace = 'marketdata' AND key = 'alpaca.adaptive_rate_limit_enabled')
    OR (namespace = 'trading' AND key = 'broker.adaptive_rate_limit_enabled'));

UPDATE config.config_values
SET description = 'Max outbound Alpaca REST calls per second. Read at startup into a token-bucket limiter the client waits on before every REST call; `0` disables rate limiting.'
WHERE namespace = 'marketdata'
  AND key = 'backfill.rate_limit_rps'
  AND description = 'Static ceiling on outbound Alpaca REST calls per second. The effective rate is the lower of this ceiling and what the X-RateLimit response headers allow (alpaca.adaptive_rate_limit_enabled). Read live per request into a token-bucket limiter the client waits on before every REST call; `0` disables only this ceiling.';
