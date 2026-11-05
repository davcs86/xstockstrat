-- Migration: 033_ledger_stream_resolve_timeout.down.sql
-- Reverses 033_ledger_stream_resolve_timeout.up.sql (removes ledger.stream.resolve_timeout_ms across all environments).

DELETE FROM config.config_values
 WHERE namespace = 'ledger'
   AND key = 'ledger.stream.resolve_timeout_ms';
