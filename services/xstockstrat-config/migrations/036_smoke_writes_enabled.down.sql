-- Migration: 036_smoke_writes_enabled.down.sql
-- Reverses 036_smoke_writes_enabled.up.sql (removes smoke.writes.enabled across all environments).

DELETE FROM config.config_values
 WHERE namespace = 'smoke'
   AND key = 'smoke.writes.enabled';
