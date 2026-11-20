-- Migration: analysis_live_enrich_ttl_reseed (down). Service: xstockstrat-config, feature 330 (fix-live-enrich-ttl-seed).
-- Reverts the value only on rows still carrying the 330 sentinel at '20'; SetConfig rewrites updated_by, so operator writes are never reverted.

WITH u AS (
  UPDATE config.config_values v
  SET value_data = CASE WHEN v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330' THEN '10' ELSE v.value_data END,
      description = CASE WHEN v.description = 'Short TTL (seconds) for the success-only per-symbol live-quote memo (feature 177). Keep it above the 15s ListOpportunities UI poll so a warm re-poll is served from the memo. Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.' THEN 'Short TTL for the success-only per-symbol live-quote/sparkline memo (feature 177). Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.' ELSE v.description END,
      updated_by = CASE WHEN v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330' THEN 'system:config-migration-feature-330' ELSE v.updated_by END,
      update_reason = CASE WHEN v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330' THEN 'feature 330 down: restore the 028 seed 10' ELSE v.update_reason END,
      caller_identity = CASE WHEN v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330' THEN NULL ELSE v.caller_identity END
  WHERE v.namespace = 'analysis'
    AND v.key = 'opportunity.live_enrich_ttl_seconds'
    AND v.user_id IS NULL
    AND v.environment IN ('staging', 'production')
    AND ((v.value_data = '20' AND v.updated_by = 'system:config-migration-feature-330') OR v.description = 'Short TTL (seconds) for the success-only per-symbol live-quote memo (feature 177). Keep it above the 15s ListOpportunities UI poll so a warm re-poll is served from the memo. Read via get_int_present (0 = memo disabled -> always fetch). Seeded unbounded.')
  RETURNING v.namespace, v.key, v.environment
), nt AS (
  SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'key', t.key, 'environment', t.environment, 'user_id', NULL)::text) AS sent
  FROM (SELECT DISTINCT namespace, key, environment FROM u) t
)
SELECT (SELECT count(*) FROM u) AS updated, (SELECT count(*) FROM nt) AS notified;
