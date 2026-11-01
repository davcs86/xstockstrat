-- Bare seed in the 025 shape: the stored form is the verbatim key column.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ingest', 'mcp_client.request_timeout_seconds', 'int', '30',
   'Per-call outbound MCP request timeout (seconds). Clamped to >=1 at read. Default 30.',
   '30', 'xstockstrat-ingest', 'staging', NULL),
  ('ingest', 'mcp_client.request_timeout_seconds', 'int', '30',
   'Per-call outbound MCP request timeout (seconds). Clamped to >=1 at read. Default 30.',
   '30', 'xstockstrat-ingest', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
