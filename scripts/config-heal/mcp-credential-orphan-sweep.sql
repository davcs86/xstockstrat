-- Operator sweep (feature 328): deletes per-user ingest mcp_credential.* secrets no signal source of the same owner references.
-- Must stay ONE statement with no transaction control: the rerun assertion \ir's it inside BEGIN ... ROLLBACK.
\if :{?grace_hours}
\else
\set grace_hours 24
\endif
WITH d AS (
  DELETE FROM config.config_values v
  WHERE
-- mcp_orphan:begin
    v.is_secret AND v.user_id IS NOT NULL AND v.namespace = 'ingest' AND starts_with(v.key, 'mcp_credential.')
    AND v.updated_at < now() - make_interval(hours => GREATEST(:'grace_hours'::int, 1))
    AND NOT EXISTS (
      SELECT 1 FROM ingest.signal_sources s
       WHERE s.user_id = v.user_id
         AND substring(s.credentials_ref from position('.' in s.credentials_ref) + 1) = v.key)
-- mcp_orphan:end
  RETURNING v.namespace, v.key, v.value_data, v.environment, v.user_id
), aud AS (
  INSERT INTO config.config_audit
    (namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)
  SELECT d.namespace, d.key, d.value_data, NULL, 'system:config-heal-mcp-credential-sweep',
         'feature 328: unreferenced mcp_credential secret reclaimed', clock_timestamp(), d.environment, d.user_id, NULL
  FROM d
), nt AS (
  SELECT pg_notify('config_changed', json_build_object('namespace', namespace, 'key', min(key),
                                                       'environment', environment, 'user_id', user_id)::text) AS sent
  FROM d
  GROUP BY namespace, environment, user_id
)
SELECT (SELECT count(*) FROM d) AS deleted, (SELECT count(*) FROM nt) AS notified;
