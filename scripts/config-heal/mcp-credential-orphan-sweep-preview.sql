-- Read-only preview of mcp-credential-orphan-sweep.sql: the marker block below must stay byte-identical to the sweep's.
\if :{?grace_hours}
\else
\set grace_hours 24
\endif
SELECT v.user_id, v.key, v.environment, now() - v.updated_at AS age, count(*) OVER () AS total
  FROM config.config_values v
  WHERE
-- mcp_orphan:begin
    v.is_secret AND v.user_id IS NOT NULL AND v.namespace = 'ingest' AND starts_with(v.key, 'mcp_credential.')
    AND v.updated_at < now() - make_interval(hours => GREATEST(:'grace_hours'::int, 1))
    AND NOT EXISTS (
      SELECT 1 FROM ingest.signal_sources s
       WHERE s.user_id = v.user_id
         AND substring(s.credentials_ref from position('.' in s.credentials_ref) + 1) = v.key)
-- mcp_orphan:end
;
