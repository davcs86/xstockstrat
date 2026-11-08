-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql
-- Migration: 044_config_keys_relative.up.sql
-- Service: xstockstrat-config — feature 296 (contract of feature 295)
-- Never apply to a shared database until allow_296 holds the operator-signed tuples (F-01).
-- Recovery never edits this file: repair the data, `migrate force 43`, re-run.

CREATE TABLE IF NOT EXISTS config.config_values_premigration_296
  (LIKE config.config_values_premigration_041);

ALTER TABLE config.config_values_premigration_296
  ADD COLUMN IF NOT EXISTS snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp();

-- Never holds a value (precedent: config_heal_report_041).
CREATE TABLE IF NOT EXISTS config.config_keys_report_296 (
  run_at      timestamptz,
  action      text,
  namespace   text,
  key         text,
  environment text,
  user_id     text,
  reason      text
);

DO $$
DECLARE
  v_by      constant text := 'system:config-migration-044';
  v_run     timestamptz := now();
  v_last    timestamptz;
  v_n       integer;
  v_msg     text;
  prev_lt   text := current_setting('lock_timeout');
BEGIN
  -- 0 Latch: the marker INSERT below is the only switch that turns the alias on.
  IF EXISTS (SELECT 1 FROM config.config_markers WHERE name = 'relative_keys_v1') THEN
    RETURN;
  END IF;

  -- 1 Lock: blocks writers, not readers (a racing SetConfig lands a gap row that 045 resolves).
  PERFORM set_config('lock_timeout', '2s', true);
  FOR i IN 1..20 LOOP
    BEGIN
      LOCK TABLE config.config_values IN SHARE ROW EXCLUSIVE MODE;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 20 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', prev_lt, true);

  -- 2 Classify every row once: prefixed = begins with "<namespace>."; rel = single-stripped key.
  CREATE TEMP TABLE cls_296 ON COMMIT DROP AS
  SELECT v.id, v.namespace AS ns, v.key, v.environment AS env, v.user_id,
         COALESCE(v.user_id, '') AS uid, v.is_secret, v.value_data, v.created_at,
         (left(v.key, length(v.namespace) + 1) = v.namespace || '.') AS prefixed,
         CASE WHEN left(v.key, length(v.namespace) + 1) = v.namespace || '.'
              THEN substr(v.key, length(v.namespace) + 2) ELSE v.key END AS rel
  FROM config.config_values v;

  -- 3 Per-user parking, computed on the pre-state.
  SELECT max(run_at) INTO v_last FROM config.config_heal_report_041;
  v_last := COALESCE(v_last, '-infinity'::timestamptz);

  CREATE TEMP TABLE s1_296 ON COMMIT DROP AS
  SELECT c.id FROM cls_296 c
  WHERE c.uid <> ''
    AND EXISTS (SELECT 1 FROM config.config_heal_report_041 h
                 WHERE h.action = 'per-user-unread' AND h.namespace = c.ns AND h.key = c.key
                   AND h.environment = c.env AND h.user_id = c.uid);

  -- Structural shape of rules (a)/(b), without the creation-time condition.
  CREATE TEMP TABLE shape_296 ON COMMIT DROP AS
  SELECT c.id, c.created_at FROM cls_296 c
  WHERE c.uid <> '' AND NOT c.prefixed
    AND EXISTS (SELECT 1 FROM cls_296 g WHERE g.ns = c.ns AND g.env = c.env AND g.uid = ''
                   AND g.prefixed AND g.rel = c.rel)
  UNION ALL
  SELECT c.id, c.created_at FROM cls_296 c
  WHERE c.uid <> '' AND c.prefixed
    AND EXISTS (SELECT 1 FROM cls_296 g WHERE g.ns = c.ns AND g.env = c.env AND g.uid = ''
                   AND NOT g.prefixed AND g.key = c.rel)
    AND NOT EXISTS (SELECT 1 FROM cls_296 g WHERE g.ns = c.ns AND g.env = c.env AND g.uid = ''
                   AND g.prefixed AND g.rel = c.rel);

  CREATE TEMP TABLE park_296 ON COMMIT DROP AS
  SELECT id FROM s1_296
  UNION
  SELECT id FROM shape_296 WHERE created_at > v_last;

  -- 4 Twin classification, per scope. Ships empty; the operator-signed tuples are pasted between
  -- the markers verbatim (a VALUES list or the empty SELECT, both valid INSERT sources).
  CREATE TEMP TABLE allow_296 (
    tid serial, namespace text, key text, environment text, user_sha256 text, value_sha256 text
  ) ON COMMIT DROP;
  INSERT INTO pg_temp.allow_296 (namespace, key, environment, user_sha256, value_sha256)
-- allow_296:begin
  SELECT NULL::text, NULL::text, NULL::text, NULL::text, NULL::text WHERE false
-- allow_296:end
  ;

  CREATE TEMP TABLE twin_296 ON COMMIT DROP AS
  SELECT p.ns, p.env, p.uid, p.rel,
         p.id AS pid, p.key AS pkey, p.is_secret AS psec, p.value_data AS pval,
         r.id AS rid, r.key AS rkey, r.is_secret AS rsec, r.value_data AS rval
  FROM cls_296 p
  JOIN cls_296 r ON r.ns = p.ns AND r.env = p.env AND r.uid = p.uid AND NOT r.prefixed AND r.key = p.rel
  WHERE p.prefixed
    AND left(p.rel, length(p.ns) + 1) <> p.ns || '.'
    AND p.id NOT IN (SELECT id FROM park_296)
    AND r.id NOT IN (SELECT id FROM park_296);

  -- A tuple is attached to a twin when its scope matches and its key is one of the two spellings.
  CREATE TEMP TABLE att_296 ON COMMIT DROP AS
  SELECT t.pid, a.tid, a.key AS akey, a.value_sha256 AS ahash
  FROM twin_296 t
  JOIN allow_296 a
    ON a.namespace = t.ns AND a.environment = t.env
   AND COALESCE(a.user_sha256, '') = CASE WHEN t.uid = '' THEN ''
                                          ELSE encode(sha256(convert_to(t.uid, 'UTF8')), 'hex') END
   AND a.key IN (t.rel, t.ns || '.' || t.rel);

  -- outcome: 'loser-p' / 'loser-r' / 'ambiguous-signature' / 'stale-signature' / 'uncovered-twin'
  CREATE TEMP TABLE out_296 ON COMMIT DROP AS
  SELECT t.pid, t.rid, t.ns, t.env, t.uid, t.rel, (t.psec OR t.rsec) AS secret_twin,
         CASE
           WHEN (SELECT count(*) FROM att_296 a WHERE a.pid = t.pid) = 0 THEN 'uncovered-twin'
           WHEN (SELECT count(*) FROM att_296 a WHERE a.pid = t.pid) > 1 THEN 'ambiguous-signature'
           WHEN EXISTS (SELECT 1 FROM att_296 a WHERE a.pid = t.pid AND a.akey = t.pkey
                          AND a.ahash = encode(sha256(convert_to(t.pval, 'UTF8')), 'hex')) THEN 'loser-p'
           WHEN EXISTS (SELECT 1 FROM att_296 a WHERE a.pid = t.pid AND a.akey = t.rkey
                          AND a.ahash = encode(sha256(convert_to(t.rval, 'UTF8')), 'hex')) THEN 'loser-r'
           ELSE 'stale-signature'
         END AS outcome
  FROM twin_296 t;

  -- 5 One RAISE before any write, one line per (ns, rel-key, env, scope) at its highest precedence.
  CREATE TEMP TABLE viol_296 (rank integer, class text, ns text, rel text, env text, per_user boolean)
    ON COMMIT DROP;
  INSERT INTO viol_296
  SELECT 1, 'secret-class-twin', ns, rel, env, uid <> '' FROM out_296 WHERE secret_twin;
  INSERT INTO viol_296
  SELECT 2, 'secret-parked-candidate', c.ns, c.rel, c.env, true
  FROM cls_296 c WHERE c.id IN (SELECT id FROM park_296) AND c.is_secret;
  INSERT INTO viol_296
  SELECT 3, 'double-prefix', c.ns, c.rel, c.env, c.uid <> ''
  FROM cls_296 c WHERE c.prefixed AND left(c.rel, length(c.ns) + 1) = c.ns || '.';
  INSERT INTO viol_296
  SELECT 4, 'oracle-mismatch', c.ns, c.rel, c.env, true
  FROM cls_296 c
  WHERE c.id IN (SELECT id FROM shape_296 WHERE created_at <= v_last)
    AND c.id NOT IN (SELECT id FROM s1_296);
  INSERT INTO viol_296
  SELECT CASE outcome WHEN 'ambiguous-signature' THEN 5 WHEN 'stale-signature' THEN 6 ELSE 7 END,
         outcome, ns, rel, env, uid <> ''
  FROM out_296
  WHERE NOT secret_twin AND outcome IN ('ambiguous-signature', 'stale-signature', 'uncovered-twin');

  SELECT count(*),
         string_agg(d.class || ' ' || d.ns || '/' || d.rel || '/' || d.env
                    || CASE WHEN d.per_user THEN ' (per-user)' ELSE '' END,
                    E'\n' ORDER BY d.rank, d.ns, d.rel, d.env)
    INTO v_n, v_msg
  FROM (SELECT DISTINCT ON (ns, rel, env, per_user) *
          FROM viol_296 ORDER BY ns, rel, env, per_user, rank) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION E'feature 296: % violation(s); nothing changed\n%', v_n, v_msg;
  END IF;

  CREATE TEMP TABLE del_296 ON COMMIT DROP AS
  SELECT pid AS id, 'twin-deleted' AS action, 'feature 296: twin loser' AS reason
    FROM out_296 WHERE outcome = 'loser-p'
  UNION ALL
  SELECT rid, 'twin-deleted', 'feature 296: twin loser' FROM out_296 WHERE outcome = 'loser-r'
  UNION ALL
  SELECT id, 'per-user-parked', 'feature 296: parked per-user row in an unread spelling'
    FROM park_296;

  -- 6 Disable the row audit trigger: its function stamps updated_at = NOW() on every UPDATE.
  ALTER TABLE config.config_values DISABLE TRIGGER config_value_audit;

  -- 7 Snapshot every row about to be touched, before any mutation; secret values are never copied.
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
  JOIN cls_296 c ON c.id = v.id
  WHERE c.prefixed OR v.id IN (SELECT id FROM del_296);

  -- 8 Delete losers and parked rows with explicit audit and report rows.
  WITH d AS (
    DELETE FROM config.config_values v
    USING del_296 x
    WHERE v.id = x.id
    RETURNING v.id, v.namespace, v.key, v.environment, v.user_id, v.value_data, v.is_secret
  ), a AS (
    INSERT INTO config.config_audit
      (namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)
    SELECT d.namespace, d.key, CASE WHEN d.is_secret THEN NULL ELSE d.value_data END, NULL, v_by,
           x.reason, clock_timestamp(), d.environment, d.user_id, NULL
    FROM d JOIN del_296 x ON x.id = d.id
  )
  INSERT INTO config.config_keys_report_296 (run_at, action, namespace, key, environment, user_id, reason)
  SELECT v_run, x.action, d.namespace, d.key, d.environment, d.user_id, x.reason
  FROM d JOIN del_296 x ON x.id = d.id;

  -- 9 Rename: a separate statement (the scope unique index is checked per row).
  WITH u AS (
    UPDATE config.config_values v
       SET key = substr(v.key, length(v.namespace) + 2)
     WHERE left(v.key, length(v.namespace) + 1) = v.namespace || '.'
    RETURNING v.namespace, v.key, v.environment, v.user_id, v.value_data, v.is_secret
  )
  INSERT INTO config.config_audit
    (namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id, caller_identity)
  SELECT u.namespace, u.key,
         CASE WHEN u.is_secret THEN NULL ELSE u.value_data END,
         CASE WHEN u.is_secret THEN NULL ELSE u.value_data END,
         v_by, 'feature 296: renamed from ' || u.namespace || '.' || u.key,
         clock_timestamp(), u.environment, u.user_id, NULL
  FROM u;

  -- 10 Re-enable the trigger; nothing prefixed may remain.
  ALTER TABLE config.config_values ENABLE TRIGGER config_value_audit;
  IF EXISTS (SELECT 1 FROM config.config_values
              WHERE left(key, length(namespace) + 1) = namespace || '.') THEN
    RAISE EXCEPTION 'feature 296: a prefixed row remains after the rename; nothing changed';
  END IF;

  -- Signed tuples attached to no twin are reported, never raised.
  INSERT INTO config.config_keys_report_296 (run_at, action, namespace, key, environment, user_id, reason)
  SELECT v_run, 'unmatched-signed-tuple', a.namespace, a.key, a.environment, NULL,
         'signed tuple attached to no twin'
  FROM allow_296 a
  WHERE a.tid NOT IN (SELECT tid FROM att_296);

  -- 11 Marker: activates the alias that feature 295 shipped dormant.
  INSERT INTO config.config_markers (name, set_at, set_by)
  VALUES ('relative_keys_v1', now(), v_by);

  -- 12 Notify, delivered at commit: one per touched (namespace, environment), then the marker.
  PERFORM pg_notify('config_changed',
                    json_build_object('namespace', t.ns, 'environment', t.env)::text)
  FROM (SELECT DISTINCT c.ns, c.env FROM cls_296 c
         WHERE c.prefixed OR c.id IN (SELECT id FROM del_296)) t;
  PERFORM pg_notify('config_changed', '{"marker":"relative_keys_v1"}');
END $$;
