-- Migration: 022_ledger_export_keys.up.sql
-- Service: xstockstrat-config
-- Seeds the ledger.export.* config keys (feature 021, ledger-event-export) for staging + production.
--
-- The `key` column carries the FULL dotted key the ledger reads (ConfigWatcher.getBool
-- ("ledger.export.enabled") / getInt("ledger.export.max_window_days")); the WatchConfig snapshot is
-- keyed by the `key` column with no namespace prefix added, so the seeded key must equal the read
-- string. `namespace` stays `ledger` (the ledger watcher subscribes to that namespace as a whole:
-- new ConfigWatcher(configEndpoint, 'ledger')).
--
-- value_type MUST be the native reader type ('bool'/'int'), never 'string': the getters preserve the
-- native oneof arm via `?? default`, so a 'string'-typed row silently returns the code default (the
-- migration-016 value_type fail-open trap). Scope: global (user_id NULL), one row per environment.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ledger', 'ledger.export.max_window_days', 'int', '365',
   'Ledger event export: maximum allowed export window in days. ExportEvents rejects a start..end span wider than this with INVALID_ARGUMENT (BFF → HTTP 400). Default 365.',
   '365', 'xstockstrat-ledger', 'staging', NULL),
  ('ledger', 'ledger.export.max_window_days', 'int', '365',
   'Ledger event export: maximum allowed export window in days. ExportEvents rejects a start..end span wider than this with INVALID_ARGUMENT (BFF → HTTP 400). Default 365.',
   '365', 'xstockstrat-ledger', 'production', NULL),
  ('ledger', 'ledger.export.enabled', 'bool', 'true',
   'Ledger event export: master on/off switch. When false, ExportEvents rejects with FAILED_PRECONDITION (BFF → HTTP 403). Default true.',
   'true', 'xstockstrat-ledger', 'staging', NULL),
  ('ledger', 'ledger.export.enabled', 'bool', 'true',
   'Ledger event export: master on/off switch. When false, ExportEvents rejects with FAILED_PRECONDITION (BFF → HTTP 403). Default true.',
   'true', 'xstockstrat-ledger', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
