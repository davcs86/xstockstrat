-- Migration: 007_marketdata_fmp.up.sql
-- Service: xstockstrat-config
-- Seeds the marketdata.fmp.* config keys (feature 059) for dev + production.
--
-- NOTE: numbered 007 (not 006) to keep the screener config-migration ordering
-- 058 -> 006_watchlist_config, 059 -> 007_marketdata_fmp, 062 -> 008 (golang-migrate
-- applies in numeric order).
--
-- The `key` column carries the FULL dotted key the marketdata service reads
-- (cfgWatcher.GetBool("marketdata.fmp.enabled"), GetString("secret.marketdata.fmp.api_key"),
-- ...): the config WatchConfig snapshot is keyed by the `key` column with no namespace
-- prefix added, so the seeded key must equal the read string for runtime values to
-- resolve. `namespace` stays `marketdata` for every row (the marketdata watcher
-- subscribes to that namespace), including the secret key.
--
-- secret.marketdata.fmp.api_key is the first seeded secret: is_secret=TRUE and the value
-- is a secret reference, never a real key.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode, is_secret)
VALUES
  ('marketdata', 'marketdata.fmp.enabled', 'bool', 'false',
   'Master gate for the FMP fundamentals source; off by default',
   'false', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.fmp.enabled', 'bool', 'false',
   'Master gate for the FMP fundamentals source; off by default',
   'false', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'secret.marketdata.fmp.api_key', 'string', 'secret://marketdata/fmp-api-key',
   'FMP API key (secret reference — resolved at deploy, never plaintext)',
   'secret://marketdata/fmp-api-key', 'xstockstrat-marketdata', 'dev', 'all', TRUE),
  ('marketdata', 'secret.marketdata.fmp.api_key', 'string', 'secret://marketdata/fmp-api-key',
   'FMP API key (secret reference — resolved at deploy, never plaintext)',
   'secret://marketdata/fmp-api-key', 'xstockstrat-marketdata', 'production', 'all', TRUE),

  ('marketdata', 'marketdata.fmp.cache_ttl_hours', 'int', '24',
   'Hours a cached fundamentals row stays fresh before a re-fetch is attempted',
   '24', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.fmp.cache_ttl_hours', 'int', '24',
   'Hours a cached fundamentals row stays fresh before a re-fetch is attempted',
   '24', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'marketdata.fmp.daily_request_cap', 'int', '250',
   'Max FMP requests per UTC day (free Basic plan budget)',
   '250', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.fmp.daily_request_cap', 'int', '250',
   'Max FMP requests per UTC day (free Basic plan budget)',
   '250', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'marketdata.fmp.base_url', 'string', 'https://financialmodelingprep.com',
   'FMP API base URL; endpoint paths are built under it',
   'https://financialmodelingprep.com', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.fmp.base_url', 'string', 'https://financialmodelingprep.com',
   'FMP API base URL; endpoint paths are built under it',
   'https://financialmodelingprep.com', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'marketdata.fmp.metrics', 'string', 'core,extended',
   'Comma-separated metric tiers to fetch (core, extended)',
   'core,extended', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.fmp.metrics', 'string', 'core,extended',
   'Comma-separated metric tiers to fetch (core, extended)',
   'core,extended', 'xstockstrat-marketdata', 'production', 'all', FALSE)
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
