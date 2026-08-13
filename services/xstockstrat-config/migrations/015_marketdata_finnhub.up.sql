-- Migration: 015_marketdata_finnhub.up.sql
-- Service: xstockstrat-config
-- Seeds the marketdata.finnhub.* + marketdata.fundamentals.provider config keys (feature 129)
-- for dev + production.
--
-- The `key` column carries the FULL dotted key the marketdata service reads (e.g.
-- cfgWatcher.GetBool("marketdata.finnhub.enabled")): the config WatchConfig snapshot is keyed by
-- the `key` column with no namespace prefix added, so the seeded key must equal the read string
-- for runtime values to resolve. `namespace` stays `marketdata` for every row (the marketdata
-- watcher subscribes to that namespace as a whole).
--
-- No credential row is seeded here — following the feature-076 precedent
-- (009_drop_fmp_api_key_config.up.sql): API keys are delivered as a DO App Platform `type: SECRET`
-- env var (`FINNHUB_API_KEY`, wired in Step 7), never a config-service row.
--
-- `marketdata.finnhub.symbols_per_minute` default of 20 is derived from Finnhub's free-tier
-- ~60 calls/minute ceiling ÷ 3 calls/symbol (`/stock/metric` + `/quote` + `/stock/profile2`, none
-- batchable) — see design.md § Chosen Approach and this feature's implementation-spec.md Step 1.
--
-- `marketdata.fundamentals.provider` is read once at boot (cmd/server/main.go, Step 7), not live.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode, is_secret)
VALUES
  ('marketdata', 'marketdata.finnhub.enabled', 'bool', 'false',
   'Master gate for the Finnhub fundamentals source; off by default',
   'false', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.finnhub.enabled', 'bool', 'false',
   'Master gate for the Finnhub fundamentals source; off by default',
   'false', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'marketdata.finnhub.base_url', 'string', 'https://api.finnhub.io/api/v1',
   'Finnhub API base URL; endpoint paths (/stock/metric, /quote, /stock/profile2) are built under it',
   'https://api.finnhub.io/api/v1', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.finnhub.base_url', 'string', 'https://api.finnhub.io/api/v1',
   'Finnhub API base URL; endpoint paths (/stock/metric, /quote, /stock/profile2) are built under it',
   'https://api.finnhub.io/api/v1', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'marketdata.finnhub.cache_ttl_hours', 'int', '24',
   'Hours a cached fundamentals row stays fresh before a re-fetch is attempted',
   '24', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.finnhub.cache_ttl_hours', 'int', '24',
   'Hours a cached fundamentals row stays fresh before a re-fetch is attempted',
   '24', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'marketdata.finnhub.symbols_per_minute', 'int', '20',
   'Max distinct symbols fetched per rolling rate_window_seconds window (derived: Finnhub free-tier ~60 calls/min / 3 calls/symbol). Re-verify against the live smoke test before raising in production.',
   '20', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.finnhub.symbols_per_minute', 'int', '20',
   'Max distinct symbols fetched per rolling rate_window_seconds window (derived: Finnhub free-tier ~60 calls/min / 3 calls/symbol). Re-verify against the live smoke test before raising in production.',
   '20', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'marketdata.finnhub.rate_window_seconds', 'int', '60',
   'Rolling window (seconds) symbols_per_minute applies over',
   '60', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.finnhub.rate_window_seconds', 'int', '60',
   'Rolling window (seconds) symbols_per_minute applies over',
   '60', 'xstockstrat-marketdata', 'production', 'all', FALSE),

  ('marketdata', 'marketdata.fundamentals.provider', 'string', 'finnhub',
   'Selects the active source.FundamentalsSource: finnhub or fmp. Read once at boot -- changing it takes effect on next restart, not live, unlike the other fundamentals keys.',
   'finnhub', 'xstockstrat-marketdata', 'dev', 'all', FALSE),
  ('marketdata', 'marketdata.fundamentals.provider', 'string', 'finnhub',
   'Selects the active source.FundamentalsSource: finnhub or fmp. Read once at boot -- changing it takes effect on next restart, not live, unlike the other fundamentals keys.',
   'finnhub', 'xstockstrat-marketdata', 'production', 'all', FALSE)
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
