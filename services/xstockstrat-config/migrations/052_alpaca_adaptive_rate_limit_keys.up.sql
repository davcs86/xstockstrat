-- Migration: 052_alpaca_adaptive_rate_limit_keys.up.sql
-- Service: xstockstrat-config, feature alpaca-adaptive-rate-limit. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('marketdata', 'alpaca.adaptive_rate_limit_enabled', 'bool', 'true',
   'Kill switch for adaptive Alpaca REST pacing in marketdata. When true the client paces requests from the X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset response headers and retries an HTTP 429 inside the call. When false it behaves as before feature 347: only the static backfill.rate_limit_rps limiter applies and a 429 is returned to the caller. Read live on every Alpaca request.',
   'true', 'xstockstrat-marketdata', 'system:config-migration-feature-alpaca-adaptive-rate-limit', 'staging', NULL),
  ('marketdata', 'alpaca.adaptive_rate_limit_enabled', 'bool', 'true',
   'Kill switch for adaptive Alpaca REST pacing in marketdata. When true the client paces requests from the X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset response headers and retries an HTTP 429 inside the call. When false it behaves as before feature 347: only the static backfill.rate_limit_rps limiter applies and a 429 is returned to the caller. Read live on every Alpaca request.',
   'true', 'xstockstrat-marketdata', 'system:config-migration-feature-alpaca-adaptive-rate-limit', 'production', NULL),
  ('trading', 'broker.adaptive_rate_limit_enabled', 'bool', 'true',
   'Kill switch for adaptive Alpaca broker pacing in trading. When true the Alpaca client paces requests from the X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset response headers and retries an HTTP 429 within a budget derived from broker.timeout_ms and order_intent.stale_multiplier. When false every broker call is one unpaced attempt, as before feature 347. Read live on every Alpaca request. IBKR is not affected.',
   'true', 'xstockstrat-trading', 'system:config-migration-feature-alpaca-adaptive-rate-limit', 'staging', NULL),
  ('trading', 'broker.adaptive_rate_limit_enabled', 'bool', 'true',
   'Kill switch for adaptive Alpaca broker pacing in trading. When true the Alpaca client paces requests from the X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset response headers and retries an HTTP 429 within a budget derived from broker.timeout_ms and order_intent.stale_multiplier. When false every broker call is one unpaced attempt, as before feature 347. Read live on every Alpaca request. IBKR is not affected.',
   'true', 'xstockstrat-trading', 'system:config-migration-feature-alpaca-adaptive-rate-limit', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;

UPDATE config.config_values
SET description = 'Static ceiling on outbound Alpaca REST calls per second. The effective rate is the lower of this ceiling and what the X-RateLimit response headers allow (alpaca.adaptive_rate_limit_enabled). Read live per request into a token-bucket limiter the client waits on before every REST call; `0` disables only this ceiling.'
WHERE namespace = 'marketdata'
  AND key = 'backfill.rate_limit_rps'
  AND description = 'Max outbound Alpaca REST calls per second. Read at startup into a token-bucket limiter the client waits on before every REST call; `0` disables rate limiting.';
