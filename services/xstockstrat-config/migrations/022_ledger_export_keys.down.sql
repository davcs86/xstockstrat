-- Migration: 022_ledger_export_keys.down.sql
-- Reverses 022_ledger_export_keys.up.sql (removes both ledger.export.* keys across all environments).

DELETE FROM config.config_values
 WHERE namespace = 'ledger'
   AND key IN ('ledger.export.max_window_days', 'ledger.export.enabled');
