-- Migration: 033_ledger_stream_resolve_timeout.up.sql
-- Service: xstockstrat-config
-- Seeds ledger.stream.resolve_timeout_ms (feature 248, fix-ledger-trimmed-notify-payload) for staging + production.
--
-- `key` must equal the full dotted string ConfigWatcher.getInt reads (namespace `ledger`), and
-- value_type must be 'int': a 'string' row makes getInt silently return the code default.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ledger', 'ledger.stream.resolve_timeout_ms', 'int', '2000',
   'Ledger StreamEvents: bound (ms) on the LISTEN-connection read that resolves a NOTIFY row trimmed over 7000 chars. Applied as statement_timeout; client backstop 2x. ≤0 or non-finite reads as 2000.',
   '2000', 'xstockstrat-ledger', 'staging', NULL),
  ('ledger', 'ledger.stream.resolve_timeout_ms', 'int', '2000',
   'Ledger StreamEvents: bound (ms) on the LISTEN-connection read that resolves a NOTIFY row trimmed over 7000 chars. Applied as statement_timeout; client backstop 2x. ≤0 or non-finite reads as 2000.',
   '2000', 'xstockstrat-ledger', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
