-- Deletes only the global rows of this key; per-user overrides are operator data and must survive rollback.
DELETE FROM config.config_values
 WHERE namespace = 'marketdata'
   AND key = 'marketdata.assets.refresh_interval_hours'
   AND user_id IS NULL;
