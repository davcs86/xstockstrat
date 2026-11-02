-- 017 shape: rename dev -> staging on config_values; the config_audit twin is not the model.
ALTER TABLE config.config_values DROP CONSTRAINT IF EXISTS config_values_environment_check;
UPDATE config.config_values SET environment = 'staging' WHERE environment = 'dev';
UPDATE config.config_audit  SET environment = 'staging' WHERE environment = 'dev';

-- trading_mode collapse (CTE-led, keeps one row per (namespace, key, environment)).
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY namespace, key, environment ORDER BY id) AS rn
    FROM config.config_values
)
DELETE FROM config.config_values c
    USING ranked r
    WHERE c.id = r.id AND r.rn > 1;
