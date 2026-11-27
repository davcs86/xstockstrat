-- Service: xstockstrat-config, feature fix-mcp-deadline-budget. Deletes only the sentinel seed rows and notifies;
-- forward-only for the up's read-timeout clamp, which this file never reverses.
WITH d AS (
  DELETE FROM config.config_values
  WHERE namespace = 'agent'
    AND key = 'extract.call_budget_seconds'
    AND value_data = '35'
    AND user_id IS NULL
    AND environment IN ('staging', 'production')
    AND updated_by = 'system:config-migration-feature-fix-mcp-deadline-budget'
  RETURNING namespace, environment
)
SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text)
FROM (SELECT DISTINCT namespace, environment FROM d) t;
