-- key must equal the full-dotted string marketdata's Watcher.GetInt reads and value_type must be 'int',
-- or GetInt silently returns the code default; value_data must stay inside the [1,24] write bounds.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('marketdata', 'marketdata.assets.refresh_interval_hours', 'int', '6',
   'Marketdata asset set: hours between Alpaca us_equity asset-list refreshes, re-read every minute. Above 24 reads as 24. A stored value <=0 pauses refreshes and keeps the current set, a reader-only defence because SetConfig rejects values below 1.',
   '6', 'xstockstrat-marketdata', 'staging', NULL),
  ('marketdata', 'marketdata.assets.refresh_interval_hours', 'int', '6',
   'Marketdata asset set: hours between Alpaca us_equity asset-list refreshes, re-read every minute. Above 24 reads as 24. A stored value <=0 pauses refreshes and keeps the current set, a reader-only defence because SetConfig rejects values below 1.',
   '6', 'xstockstrat-marketdata', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
