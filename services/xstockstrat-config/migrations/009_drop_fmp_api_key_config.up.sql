-- Feature 076 — remove the FMP API key from the config store.
--
-- Feature 059 seeded `secret.marketdata.fmp.api_key` as a config row, the only
-- is_secret row on the platform. Its comment described a `secret://` reference
-- "resolved at deploy, never plaintext" — but no resolver was ever built, and
-- xstockstrat-marketdata passed the value straight to the FMP client as the API
-- key. Storing the real key here would have made it the first genuine plaintext
-- credential in config.config_values, readable by any WatchConfig subscriber.
--
-- Every other credential on the platform (Alpaca, JWT, MCP agent, broker
-- encryption key) is delivered as a DigitalOcean App Platform `type: SECRET`
-- environment variable. The FMP key now follows the same mechanism via
-- FMP_API_KEY, so this row is removed.
--
-- The non-secret FMP knobs (marketdata.fmp.enabled, base_url, metrics) stay in
-- config — only the credential moves.

DELETE FROM config.config_values
 WHERE namespace = 'marketdata'
   AND key = 'secret.marketdata.fmp.api_key';
