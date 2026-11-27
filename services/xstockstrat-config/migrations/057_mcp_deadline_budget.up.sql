-- Service: xstockstrat-config, feature fix-mcp-deadline-budget. One statement; the clamp is global-only and must stay a
-- verbatim copy of PREPARE mdb_clamp in scripts/migration-assertions/config-mcp-deadline-budget.sql.
WITH seed AS (
  INSERT INTO config.config_values
    (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
  VALUES
    ('agent', 'extract.call_budget_seconds', 'float', '35',
     'Whole-call budget (seconds) for the URL fetches of one extract_email_content / extract_website_content call. Identity auth (10 s) + the source lookup (10 s) + this value must stay at or below 57 s, 3 s under the MCP client''s 60 s timeout. Read live; a non-finite or <= 0 value reads as 35. SetConfig-bounded [5,35].',
     '35', 'xstockstrat-agent', 'system:config-migration-feature-fix-mcp-deadline-budget', 'staging', NULL),
    ('agent', 'extract.call_budget_seconds', 'float', '35',
     'Whole-call budget (seconds) for the URL fetches of one extract_email_content / extract_website_content call. Identity auth (10 s) + the source lookup (10 s) + this value must stay at or below 57 s, 3 s under the MCP client''s 60 s timeout. Read live; a non-finite or <= 0 value reads as 35. SetConfig-bounded [5,35].',
     '35', 'xstockstrat-agent', 'system:config-migration-feature-fix-mcp-deadline-budget', 'production', NULL)
  ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING
  RETURNING namespace, environment
), heal AS (
  UPDATE config.config_values
  SET value_data = '44',
      updated_by = 'system:config-migration-feature-fix-mcp-deadline-budget',
      update_reason = 'feature fix-mcp-deadline-budget: clamp to MCP-safe ceiling',
      caller_identity = NULL
  WHERE namespace = 'agent'
    AND key = 'opportunities.read_timeout_seconds'
    AND user_id IS NULL
    AND NOT is_secret
    AND CASE WHEN value_data ~ '^[+-]?([0-9]{1,30}(\.[0-9]{0,30})?|\.[0-9]{1,30})([eE][+-]?[0-9]{1,3})?$'
             THEN value_data::numeric > 44 ELSE false END
  RETURNING namespace, environment
), nt AS (
  SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) AS sent
  FROM (SELECT DISTINCT namespace, environment
        FROM (SELECT namespace, environment FROM seed UNION ALL SELECT namespace, environment FROM heal) u) t
)
SELECT (SELECT count(*) FROM seed) AS seeded, (SELECT count(*) FROM heal) AS clamped, (SELECT count(*) FROM nt) AS notified;
