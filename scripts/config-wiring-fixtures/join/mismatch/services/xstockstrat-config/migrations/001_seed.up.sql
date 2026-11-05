INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ingest', 'mcp_client.request_timeout_seconds', 'int', '30', FALSE, 'bare seed, dotted read', '30', 'xstockstrat-ingest', 'staging',    NULL),
  ('ingest', 'mcp_client.request_timeout_seconds', 'int', '30', FALSE, 'bare seed, dotted read', '30', 'xstockstrat-ingest', 'production', NULL),
  ('ingest', 'ingest.signals.window_hours',        'int', '24', FALSE, 'dotted seed, bare read', '24', 'xstockstrat-ingest', 'staging',    NULL),
  ('ingest', 'ingest.signals.window_hours',        'int', '24', FALSE, 'dotted seed, bare read', '24', 'xstockstrat-ingest', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
