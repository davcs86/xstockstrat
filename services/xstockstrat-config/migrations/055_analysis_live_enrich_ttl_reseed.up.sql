-- Migration: analysis_live_enrich_ttl_reseed (up). Service: xstockstrat-config, feature 330 (fix-live-enrich-ttl-seed).
-- Only the seeded '10' moves to '20' (operator values survive); actor columns change only with the value. The final SELECT forces the notify CTE.

WITH u AS (
  UPDATE config.config_values v
  SET value_data = CASE WHEN v.value_data = '10' THEN '20' ELSE v.value_data END,
      description = CASE WHEN v.description = 'Short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177). Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.'
        THEN 'Short TTL (seconds) for the success-only per-symbol live-quote memo (feature 177). Keep it above the 15s ListOpportunities UI poll so a warm re-poll is served from the memo. Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.'
        ELSE v.description END,
      updated_by = CASE WHEN v.value_data = '10' THEN 'system:config-migration-feature-330' ELSE v.updated_by END,
      update_reason = CASE WHEN v.value_data = '10' THEN 'feature 330: reseed the 028 live-enrich memo TTL 10 -> 20, above the 15s UI poll' ELSE v.update_reason END,
      caller_identity = CASE WHEN v.value_data = '10' THEN NULL ELSE v.caller_identity END
  WHERE v.namespace = 'analysis'
    AND v.key = 'opportunity.live_enrich_ttl_seconds'
    AND v.user_id IS NULL
    AND v.environment IN ('staging', 'production')
    AND (v.value_data = '10' OR v.description = 'Short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177). Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.')
  RETURNING v.namespace, v.key, v.environment
), nt AS (
  SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'key', t.key, 'environment', t.environment, 'user_id', NULL)::text) AS sent
  FROM (SELECT DISTINCT namespace, key, environment FROM u) t
)
SELECT (SELECT count(*) FROM u) AS updated, (SELECT count(*) FROM nt) AS notified;
