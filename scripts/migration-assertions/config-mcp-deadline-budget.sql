-- feature fix-mcp-deadline-budget (AC-1, AC-2): run by migration-rerun.py after all migrations.
-- PREPARE mdb_clamp is a copy of the heal CTE's statement in *_mcp_deadline_budget.up.sql; change both together.
BEGIN;

CREATE TEMP TABLE mdb_rc (step text PRIMARY KEY, n int NOT NULL) ON COMMIT DROP;

PREPARE mdb_clamp AS
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
  RETURNING namespace, environment;

-- ── above the ceiling: global 55 / 44.5 are clamped, a per-user 50 is not ───────────────────────────
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, updated_by, caller_identity, environment, user_id)
VALUES
  ('agent', 'opportunities.read_timeout_seconds', 'float', '55', 'mdb-assert-setup', 'mdb-assert-caller', 'staging', NULL),
  ('agent', 'opportunities.read_timeout_seconds', 'float', '44.5', 'mdb-assert-setup', 'mdb-assert-caller', 'production', NULL),
  ('agent', 'opportunities.read_timeout_seconds', 'float', '50', 'mdb-assert-setup', 'mdb-assert-caller', 'staging', 'mdb-assert-user')
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO UPDATE
  SET value_data = EXCLUDED.value_data, updated_by = EXCLUDED.updated_by, caller_identity = EXCLUDED.caller_identity;

EXECUTE mdb_clamp;
INSERT INTO mdb_rc VALUES ('clamp', :ROW_COUNT);
EXECUTE mdb_clamp;
INSERT INTO mdb_rc VALUES ('replay', :ROW_COUNT);

DO $$
BEGIN
  IF (SELECT count(*) FROM config.config_values
       WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds' AND user_id IS NULL
         AND environment IN ('staging', 'production') AND value_data = '44'
         AND updated_by = 'system:config-migration-feature-fix-mcp-deadline-budget'
         AND caller_identity IS NULL) <> 2 THEN
    RAISE EXCEPTION 'AC-2: global 55 / 44.5 were not clamped to 44 with the sentinel and a NULL caller_identity';
  END IF;
  IF (SELECT count(DISTINCT environment) FROM config.config_audit
       WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds' AND user_id IS NULL
         AND new_value = '44' AND changed_by = 'system:config-migration-feature-fix-mcp-deadline-budget'
         AND caller_identity IS NULL) <> 2 THEN
    RAISE EXCEPTION 'AC-2: the clamp did not write one sentinel audit row per environment';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values
                  WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds'
                    AND user_id = 'mdb-assert-user' AND value_data = '50'
                    AND caller_identity = 'mdb-assert-caller') THEN
    RAISE EXCEPTION 'the clamp rewrote a per-user row';
  END IF;
END $$;

-- ── at or below the ceiling, or not a plain number: untouched, and the cast never raises ────────────
UPDATE config.config_values SET value_data = '40', updated_by = 'mdb-assert-setup'
 WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds' AND user_id IS NULL AND environment = 'staging';
UPDATE config.config_values SET value_data = 'abc', updated_by = 'mdb-assert-setup'
 WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds' AND user_id IS NULL AND environment = 'production';
EXECUTE mdb_clamp;
INSERT INTO mdb_rc VALUES ('40-abc', :ROW_COUNT);

UPDATE config.config_values SET value_data = '50s', updated_by = 'mdb-assert-setup'
 WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds' AND user_id IS NULL AND environment = 'production';
EXECUTE mdb_clamp;
INSERT INTO mdb_rc VALUES ('50s', :ROW_COUNT);

DO $$
DECLARE
  bad text;
BEGIN
  IF (SELECT value_data FROM config.config_values
       WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds' AND user_id IS NULL
         AND environment = 'staging') IS DISTINCT FROM '40' THEN
    RAISE EXCEPTION 'the clamp changed a global 40';
  END IF;
  IF (SELECT value_data FROM config.config_values
       WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds' AND user_id IS NULL
         AND environment = 'production') IS DISTINCT FROM '50s' THEN
    RAISE EXCEPTION 'the clamp changed a non-numeric global value';
  END IF;

  SELECT string_agg(format('%s=%s (want %s)', want.step, rc.n, want.n), ', ') INTO bad
    FROM (VALUES ('clamp', 2), ('replay', 0), ('40-abc', 0), ('50s', 0)) AS want(step, n)
    LEFT JOIN mdb_rc rc USING (step)
   WHERE rc.n IS DISTINCT FROM want.n;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected clamp row counts: %', bad;
  END IF;
END $$;

-- ── the seed ────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM config.config_values
       WHERE namespace = 'agent' AND key = 'extract.call_budget_seconds' AND user_id IS NULL
         AND environment IN ('staging', 'production') AND value_data = '35'
         AND value_type = 'float' AND default_value = '35') <> 2 THEN
    RAISE EXCEPTION 'AC-1: agent extract.call_budget_seconds is not seeded at 35 in both environments';
  END IF;
END $$;

-- Reported, not asserted: per-user rows of the clamped key above 44 are never rewritten (the clamp is global-only).
DO $$
BEGIN
  RAISE NOTICE 'feature fix-mcp-deadline-budget: per-user read_timeout_seconds rows above 44: %',
    (SELECT count(*) FROM config.config_values
      WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds'
        AND user_id IS NOT NULL AND user_id <> 'mdb-assert-user'
        AND CASE WHEN value_data ~ '^[+-]?([0-9]{1,30}(\.[0-9]{0,30})?|\.[0-9]{1,30})([eE][+-]?[0-9]{1,3})?$'
                 THEN value_data::numeric > 44 ELSE false END);
END $$;

ROLLBACK;
