-- Migration: 035_smoke_rpc_user_id.down.sql
-- Reverses 035_smoke_rpc_user_id.up.sql (removes smoke.rpc.user_id across all environments).

DELETE FROM config.config_values
 WHERE namespace = 'smoke'
   AND key = 'smoke.rpc.user_id';
