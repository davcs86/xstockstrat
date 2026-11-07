-- Migration: 042_marketdata_bar_ingest_backoff.up.sql
-- Service: xstockstrat-config
-- Seeds marketdata.stream.bar_ingest_backoff_ms (feature 291, fix-marketdata-dead-symbol-ingest) for staging + production.
--
-- `key` must equal the full dotted string marketdata's Watcher.GetInt reads (namespace `marketdata`), and
-- value_type must be 'int': a 'string' row makes GetInt silently return the code default.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('marketdata', 'marketdata.stream.bar_ingest_backoff_ms', 'int', '21600000',
   'Marketdata bar ingest: how long (ms) a warm symbol must return no bars across informative bar-ingest cycles before the ingester leaves it out of the vendor request; also the probe period while held. <=0 disables the hold and clears hold state. Bounded [0, 86400000]. Trade-off: a false-positive hold lags that symbol''s stored daily bar by up to this value. Seeded at the code default, so applying this changes no runtime behaviour.',
   '21600000', 'xstockstrat-marketdata', 'staging', NULL),
  ('marketdata', 'marketdata.stream.bar_ingest_backoff_ms', 'int', '21600000',
   'Marketdata bar ingest: how long (ms) a warm symbol must return no bars across informative bar-ingest cycles before the ingester leaves it out of the vendor request; also the probe period while held. <=0 disables the hold and clears hold state. Bounded [0, 86400000]. Trade-off: a false-positive hold lags that symbol''s stored daily bar by up to this value. Seeded at the code default, so applying this changes no runtime behaviour.',
   '21600000', 'xstockstrat-marketdata', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
