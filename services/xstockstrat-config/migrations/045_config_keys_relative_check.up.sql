-- Migration: 045_config_keys_relative_check.up.sql
-- Service: xstockstrat-config — feature 296 (CHECK half of the contract)
-- Re-strips any prefixed row a previous-image server inserted after 044, then forbids the form.
-- Recovery never edits this file: repair the data, `migrate force 44`, re-run.

DO $$
DECLARE
  v_by    constant text := 'system:config-migration-045';
  v_run   timestamptz := now();
  v_n     integer;
  v_msg   text;
  prev_lt text := current_setting('lock_timeout');
BEGIN
  -- Lock: the CHECK needs ACCESS EXCLUSIVE; bounded retries (a held lock fails the deploy loudly).
  PERFORM set_config('lock_timeout', '2s', true);
  FOR i IN 1..20 LOOP
    BEGIN
      LOCK TABLE config.config_values IN ACCESS EXCLUSIVE MODE;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 20 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', prev_lt, true);

  -- A gap twin: a prefixed row P beside a relative row in the same scope. Newest write wins; a
  -- migration-authored P (author NULL or system:%) always loses.
  CREATE TEMP TABLE gap_296 ON COMMIT DROP AS
  SELECT p.id AS pid, r.id AS rid, p.namespace AS ns, p.environment AS env,
         COALESCE(p.user_id, '') AS uid, r.key AS rel,
         p.is_secret AS psec, r.is_secret AS rsec,
         CASE WHEN p.updated_by IS NULL OR p.updated_by LIKE 'system:%' THEN 'gap-twin-system-deleted'
              WHEN p.updated_at >= r.updated_at THEN 'gap-twin-p-wins'
              ELSE 'gap-twin-rel-won' END AS outcome
  FROM config.config_values p
  JOIN config.config_values r
    ON r.namespace = p.namespace AND r.environment = p.environment
   AND COALESCE(r.user_id, '') = COALESCE(p.user_id, '')
   AND r.key = substr(p.key, length(p.namespace) + 2)
  WHERE left(p.key, length(p.namespace) + 1) = p.namespace || '.'
    AND left(r.key, length(r.namespace) + 1) <> r.namespace || '.';

  -- The only violation: exactly one member of a gap twin is a secret. Both-secret twins resolve
  -- by the same rule, with audit values NULL.
  SELECT count(*),
         string_agg('mixed-class-gap-twin ' || d.ns || '/' || d.rel || '/' || d.env,
                    E'\n' ORDER BY d.ns, d.rel, d.env)
    INTO v_n, v_msg
  FROM (SELECT DISTINCT ns, rel, env FROM gap_296 WHERE psec <> rsec) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION E'feature 296: % violation(s); nothing changed\n%', v_n, v_msg;
  END IF;

  CREATE TEMP TABLE del_296b ON COMMIT DROP AS
  SELECT pid AS id,
         CASE outcome WHEN 'gap-twin-system-deleted' THEN 'feature 296: gap twin, migration-seeded prefixed row'
                      ELSE 'feature 296: gap twin, superseded by newer write to ' || rel END AS reason
    FROM gap_296 WHERE outcome IN ('gap-twin-system-deleted', 'gap-twin-rel-won')
  UNION ALL
  SELECT rid, 'feature 296: gap twin, superseded by newer write to ' || rel
    FROM gap_296 WHERE outcome = 'gap-twin-p-wins';

  CREATE TEMP TABLE touched_296b (ns text, env text) ON COMMIT DROP;
  INSERT INTO touched_296b
  SELECT v.namespace, v.environment FROM config.config_values v
   WHERE v.id IN (SELECT id FROM del_296b);

  -- Snapshot every loser and every row about to be renamed; secret values are never copied.
  INSERT INTO config.config_values_premigration_296
    (id, namespace, key, value_type, value_data, is_secret, description, default_value,
     consuming_service, updated_by, update_reason, created_at, updated_at, environment,
     caller_identity, user_id, snapshot_at)
  SELECT v.id, v.namespace, v.key, v.value_type,
         CASE WHEN v.is_secret THEN NULL ELSE v.value_data END,
         v.is_secret, v.description,
         CASE WHEN v.is_secret THEN NULL ELSE v.default_value END,
         v.consuming_service, v.updated_by, v.update_reason, v.created_at, v.updated_at,
         v.environment, v.caller_identity, v.user_id, clock_timestamp()
  FROM config.config_values v
  WHERE v.id IN (SELECT id FROM del_296b)
     OR left(v.key, length(v.namespace) + 1) = v.namespace || '.';

  -- Statement 1: delete the losers with explicit audit rows.
  WITH d AS (
    DELETE FROM config.config_values v
    USING del_296b x
    WHERE v.id = x.id
    RETURNING v.id, v.namespace, v.key, v.environment, v.user_id, v.value_data, v.is_secret
  )
  INSERT INTO config.config_audit
    (namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)
  SELECT d.namespace, d.key, CASE WHEN d.is_secret THEN NULL ELSE d.value_data END, NULL, v_by,
         x.reason, clock_timestamp(), d.environment, d.user_id, NULL
  FROM d JOIN del_296b x ON x.id = d.id;

  INSERT INTO config.config_keys_report_296 (run_at, action, namespace, key, environment, user_id, reason)
  SELECT v_run, outcome, ns, rel, env, NULLIF(uid, ''), 'feature 296: gap twin resolved'
  FROM gap_296;

  -- Statement 2: rename every remaining singly-prefixed row. updated_at and updated_by are kept
  -- because the row audit trigger (which stamps updated_at) is off for this statement only.
  ALTER TABLE config.config_values DISABLE TRIGGER config_value_audit;
  WITH u AS (
    UPDATE config.config_values v
       SET key = substr(v.key, length(v.namespace) + 2)
     WHERE left(v.key, length(v.namespace) + 1) = v.namespace || '.'
       AND left(substr(v.key, length(v.namespace) + 2), length(v.namespace) + 1) <> v.namespace || '.'
    RETURNING v.namespace, v.key, v.environment, v.user_id, v.value_data, v.is_secret
  ), a AS (
    INSERT INTO config.config_audit
      (namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)
    SELECT u.namespace, u.key,
           CASE WHEN u.is_secret THEN NULL ELSE u.value_data END,
           CASE WHEN u.is_secret THEN NULL ELSE u.value_data END,
           v_by, 'feature 296: renamed from ' || u.namespace || '.' || u.key,
           clock_timestamp(), u.environment, u.user_id, NULL
    FROM u
  )
  INSERT INTO touched_296b SELECT u.namespace, u.environment FROM u;
  ALTER TABLE config.config_values ENABLE TRIGGER config_value_audit;

  -- The constraint is the assertion: a doubly-prefixed row left in place fails here with 23514.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'config_values_key_relative_check'
                    AND conrelid = 'config.config_values'::regclass) THEN
    ALTER TABLE config.config_values
      ADD CONSTRAINT config_values_key_relative_check
      CHECK (left(key, length(namespace) + 1) <> namespace || '.');
  END IF;

  PERFORM pg_notify('config_changed',
                    json_build_object('namespace', t.ns, 'environment', t.env)::text)
  FROM (SELECT DISTINCT ns, env FROM touched_296b) t;
END $$;
