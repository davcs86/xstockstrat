-- Deletes only the global rows of this key; per-user overrides are operator data and must survive rollback.
DELETE FROM config.config_values
 WHERE namespace = 'portfolio'
   AND key = 'portfolio.marketdata.servability_timeout_ms'
   AND user_id IS NULL;
