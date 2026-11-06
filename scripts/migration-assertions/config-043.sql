-- config 043 (AC-1, AC-3, AC-4, AC-7, AC-9, AC-10, AC-12): run by migration-rerun.sh after passes 0-3.
-- Replays the 043 up/down files: a later migration touching these rows must update or retire this file.

DO $$
DECLARE
  bad TEXT;
  twins BIGINT;
BEGIN
  SELECT string_agg(format('%s/%s (rows=%s value=%s type=%s)', e.env, w.key, c.n, c.vals, c.types), '; ')
    INTO bad
    FROM (VALUES ('production'), ('staging')) AS e(env)
   CROSS JOIN (VALUES ('analysis.engine.max_strategies_per_cycle', '50')) AS w(key, val)
   CROSS JOIN LATERAL (
     SELECT count(*) AS n,
            string_agg(v.value_data, ',') AS vals,
            string_agg(v.value_type, ',') AS types,
            COALESCE(bool_and(v.value_type = 'int' AND v.value_data = w.val AND v.default_value = w.val
                     AND COALESCE(v.description, '') <> ''
                     AND v.consuming_service = 'xstockstrat-analysis'), false) AS ok
       FROM config.config_values v
      WHERE v.namespace = 'analysis' AND v.key = w.key
        AND v.environment = e.env AND v.user_id IS NULL
   ) AS c
   WHERE c.n <> 1 OR NOT c.ok;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'AC-1: global budget row missing or wrong (want int 50, default 50, description, consumer): %', bad;
  END IF;

  SELECT count(*) INTO twins
    FROM config.config_values
   WHERE namespace = 'analysis' AND key = 'engine.max_strategies_per_cycle';
  IF twins <> 0 THEN
    RAISE EXCEPTION 'AC-1: % namespace-stripped engine.max_strategies_per_cycle rows exist', twins;
  END IF;

  SELECT string_agg(format('%s/%s (rows=%s value=%s type=%s)', e.env, w.key, c.n, c.vals, c.types), '; ')
    INTO bad
    FROM (VALUES ('production'), ('staging')) AS e(env)
   CROSS JOIN (VALUES ('analysis.engine.eval_interval_seconds', '60')) AS w(key, val)
   CROSS JOIN LATERAL (
     SELECT count(*) AS n,
            string_agg(v.value_data, ',') AS vals,
            string_agg(v.value_type, ',') AS types,
            COALESCE(bool_and(v.value_type = 'int' AND v.value_data = w.val AND v.default_value = w.val
                     AND COALESCE(v.description, '') <> ''
                     AND v.consuming_service = 'xstockstrat-analysis'), false) AS ok
       FROM config.config_values v
      WHERE v.namespace = 'analysis' AND v.key = w.key
        AND v.environment = e.env AND v.user_id IS NULL
   ) AS c
   WHERE c.n <> 1 OR NOT c.ok;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'AC-10: global interval row missing or wrong (want int 60, default 60, description, consumer): %', bad;
  END IF;

  SELECT count(*) INTO twins
    FROM config.config_values
   WHERE namespace = 'analysis' AND key = 'engine.eval_interval_seconds';
  IF twins <> 0 THEN
    RAISE EXCEPTION 'AC-10: % namespace-stripped engine.eval_interval_seconds rows exist', twins;
  END IF;
END $$;

BEGIN;

DELETE FROM config.config_values
 WHERE namespace = 'analysis'
   AND key IN ('analysis.engine.max_strategies_per_cycle', 'analysis.engine.eval_interval_seconds');

-- The ledger rows reuse the two key strings so a predicate missing its namespace filter touches them.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('analysis', 'analysis.engine.max_strategies_per_cycle', 'int', '200', '', NULL, NULL, 'admin-x', 'staging', NULL),
  ('analysis', 'analysis.engine.eval_interval_seconds', 'int', '90', NULL, NULL, NULL, NULL, 'staging', NULL),
  ('analysis', 'analysis.engine.max_strategies_per_cycle', 'int', '75', NULL, NULL, NULL, NULL, 'staging', 'user-2'),
  ('analysis', 'analysis.engine.max_strategies_per_cycle', 'int', '50', NULL, NULL, NULL, NULL, 'staging', 'user-3'),
  ('analysis', 'analysis.engine.eval_interval_seconds', 'int', '60', NULL, NULL, NULL, NULL, 'staging', 'user-2'),
  ('analysis', 'analysis.engine.alert_throttle_seconds', 'int', '60', NULL, NULL, NULL, NULL, 'staging', NULL),
  ('ledger', 'analysis.engine.eval_interval_seconds', 'int', '60', NULL, NULL, NULL, NULL, 'staging', NULL),
  ('ledger', 'analysis.engine.max_strategies_per_cycle', 'int', '50', NULL, NULL, NULL, NULL, 'staging', NULL);

CREATE TEMP TABLE a_043 AS SELECT COALESCE(max(id), 0) AS m FROM config.config_audit;
CREATE TEMP TABLE b_043 AS SELECT * FROM config.config_values;

\ir ../../services/xstockstrat-config/migrations/043_analysis_live_loop_keys.up.sql

DO $$
DECLARE
  n BIGINT;
  m0 BIGINT;
BEGIN
  SELECT count(*) INTO n
    FROM config.config_values
   WHERE namespace = 'analysis' AND key = 'analysis.engine.max_strategies_per_cycle'
     AND environment = 'staging' AND user_id IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'AC-3: staging global budget rows=% after the seed (want 1)', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values
                  WHERE namespace = 'analysis' AND key = 'analysis.engine.max_strategies_per_cycle'
                    AND environment = 'staging' AND user_id IS NULL
                    AND value_data = '200' AND value_type = 'int' AND updated_by = 'admin-x'
                    AND description <> '' AND default_value = '50'
                    AND consuming_service = 'xstockstrat-analysis') THEN
    RAISE EXCEPTION 'AC-3: staging budget not kept at int 200 by admin-x with description/default 50/consumer backfilled';
  END IF;

  SELECT count(*) INTO n
    FROM config.config_values
   WHERE namespace = 'analysis' AND key = 'analysis.engine.eval_interval_seconds'
     AND environment = 'staging' AND user_id IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'AC-3: staging global interval rows=% after the seed (want 1)', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values
                  WHERE namespace = 'analysis' AND key = 'analysis.engine.eval_interval_seconds'
                    AND environment = 'staging' AND user_id IS NULL
                    AND value_data = '90' AND value_type = 'int' AND updated_by IS NULL
                    AND description <> '' AND default_value = '60'
                    AND consuming_service = 'xstockstrat-analysis') THEN
    RAISE EXCEPTION 'AC-3: staging interval not kept at int 90 with description/default 60/consumer backfilled';
  END IF;

  SELECT count(*) INTO n
    FROM config.config_values
   WHERE namespace = 'analysis' AND environment = 'production' AND user_id IS NULL
     AND value_type = 'int' AND updated_by = 'system:config-migration-043'
     AND ((key = 'analysis.engine.max_strategies_per_cycle' AND value_data = '50')
       OR (key = 'analysis.engine.eval_interval_seconds' AND value_data = '60'));
  IF n <> 2 THEN
    RAISE EXCEPTION 'AC-3: production seeded rows (50/60 by system:config-migration-043) = % (want 2)', n;
  END IF;

  SELECT m INTO m0 FROM a_043;
  SELECT count(*) INTO n FROM config.config_audit WHERE id > m0;
  IF n <> 2 THEN
    RAISE EXCEPTION 'AC-3: seed wrote % config_audit rows (want 2, production inserts only)', n;
  END IF;
  SELECT count(DISTINCT key) INTO n
    FROM config.config_audit
   WHERE id > m0 AND namespace = 'analysis' AND environment = 'production' AND user_id IS NULL
     AND old_value IS NULL AND changed_by = 'system:config-migration-043'
     AND ((key = 'analysis.engine.max_strategies_per_cycle' AND new_value = '50')
       OR (key = 'analysis.engine.eval_interval_seconds' AND new_value = '60'));
  IF n <> 2 THEN
    RAISE EXCEPTION 'AC-3: the 2 new audit rows are not one production insert per key by the sentinel (distinct keys=%)', n;
  END IF;

  SELECT count(*) INTO n FROM (
    (SELECT * FROM config.config_values
      WHERE NOT (namespace = 'analysis' AND user_id IS NULL
                 AND key IN ('analysis.engine.max_strategies_per_cycle', 'analysis.engine.eval_interval_seconds'))
     EXCEPT SELECT * FROM b_043
      WHERE NOT (namespace = 'analysis' AND user_id IS NULL
                 AND key IN ('analysis.engine.max_strategies_per_cycle', 'analysis.engine.eval_interval_seconds')))
    UNION ALL
    (SELECT * FROM b_043
      WHERE NOT (namespace = 'analysis' AND user_id IS NULL
                 AND key IN ('analysis.engine.max_strategies_per_cycle', 'analysis.engine.eval_interval_seconds'))
     EXCEPT SELECT * FROM config.config_values
      WHERE NOT (namespace = 'analysis' AND user_id IS NULL
                 AND key IN ('analysis.engine.max_strategies_per_cycle', 'analysis.engine.eval_interval_seconds')))
  ) d;
  IF n <> 0 THEN
    RAISE EXCEPTION 'AC-3: seed changed % rows outside the two keys'' global analysis rows', n;
  END IF;
END $$;

CREATE TEMP TABLE a2_043 AS SELECT COALESCE(max(id), 0) AS m FROM config.config_audit;
CREATE TEMP TABLE c_043 AS SELECT * FROM config.config_values;

\ir ../../services/xstockstrat-config/migrations/043_analysis_live_loop_keys.up.sql

DO $$
DECLARE
  bad TEXT;
  n BIGINT;
  m2 BIGINT;
BEGIN
  SELECT string_agg(format('%s/%s (rows=%s value=%s)', w.env, w.key, c.n, c.vals), '; ')
    INTO bad
    FROM (VALUES
        ('staging', 'analysis.engine.max_strategies_per_cycle', '200'),
        ('staging', 'analysis.engine.eval_interval_seconds', '90'),
        ('production', 'analysis.engine.max_strategies_per_cycle', '50'),
        ('production', 'analysis.engine.eval_interval_seconds', '60')
      ) AS w(env, key, val)
   CROSS JOIN LATERAL (
     SELECT count(*) AS n,
            string_agg(v.value_data, ',') AS vals,
            COALESCE(bool_and(v.value_data = w.val), false) AS ok
       FROM config.config_values v
      WHERE v.namespace = 'analysis' AND v.key = w.key
        AND v.environment = w.env AND v.user_id IS NULL
   ) AS c
   WHERE c.n <> 1 OR NOT c.ok;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'AC-4: second apply left wrong global rows: %', bad;
  END IF;

  SELECT m INTO m2 FROM a2_043;
  SELECT count(*) INTO n FROM config.config_audit WHERE id > m2;
  IF n <> 0 THEN
    RAISE EXCEPTION 'AC-4: second apply wrote % config_audit rows (want 0)', n;
  END IF;

  -- Cannot detect a spurious re-UPDATE: NOW() is constant inside a transaction, so updated_at would not
  -- move; idempotency of the metadata UPDATEs rests on their WHERE guard.
  SELECT count(*) INTO n FROM (
    (SELECT * FROM config.config_values EXCEPT SELECT * FROM c_043)
    UNION ALL
    (SELECT * FROM c_043 EXCEPT SELECT * FROM config.config_values)
  ) d;
  IF n <> 0 THEN
    RAISE EXCEPTION 'AC-4: second apply changed % rows', n;
  END IF;
END $$;

\ir ../../services/xstockstrat-config/migrations/043_analysis_live_loop_keys.down.sql

DO $$
DECLARE
  n BIGINT;
BEGIN
  SELECT count(*) INTO n
    FROM config.config_values
   WHERE namespace = 'analysis' AND environment = 'production' AND user_id IS NULL
     AND key = 'analysis.engine.max_strategies_per_cycle';
  IF n <> 0 THEN
    RAISE EXCEPTION 'AC-7: production seeded budget row survived the down (rows=%)', n;
  END IF;

  SELECT count(*) INTO n
    FROM config.config_values
   WHERE namespace = 'analysis' AND environment = 'production' AND user_id IS NULL
     AND key = 'analysis.engine.eval_interval_seconds';
  IF n <> 0 THEN
    RAISE EXCEPTION 'AC-12: production seeded interval row survived the down (rows=%)', n;
  END IF;

  SELECT count(*) INTO n
    FROM config.config_values
   WHERE environment = 'staging'
     AND ((namespace = 'analysis' AND key = 'analysis.engine.max_strategies_per_cycle'
           AND user_id IS NULL AND value_data = '200')
       OR (namespace = 'analysis' AND key = 'analysis.engine.max_strategies_per_cycle'
           AND user_id = 'user-2' AND value_data = '75')
       OR (namespace = 'analysis' AND key = 'analysis.engine.max_strategies_per_cycle'
           AND user_id = 'user-3' AND value_data = '50')
       OR (namespace = 'ledger' AND key = 'analysis.engine.max_strategies_per_cycle'
           AND user_id IS NULL AND value_data = '50'));
  IF n <> 4 THEN
    RAISE EXCEPTION 'AC-7: down removed an operator budget row (staging 200, user-2 75, user-3 50, ledger 50 present=% of 4)', n;
  END IF;

  SELECT count(*) INTO n
    FROM config.config_values
   WHERE environment = 'staging'
     AND ((namespace = 'analysis' AND key = 'analysis.engine.eval_interval_seconds'
           AND user_id IS NULL AND value_data = '90')
       OR (namespace = 'analysis' AND key = 'analysis.engine.eval_interval_seconds'
           AND user_id = 'user-2' AND value_data = '60')
       OR (namespace = 'analysis' AND key = 'analysis.engine.alert_throttle_seconds'
           AND user_id IS NULL AND value_data = '60')
       OR (namespace = 'ledger' AND key = 'analysis.engine.eval_interval_seconds'
           AND user_id IS NULL AND value_data = '60'));
  IF n <> 4 THEN
    RAISE EXCEPTION 'AC-12: down removed an operator interval/unrelated row (staging 90, user-2 60, alert_throttle 60, ledger 60 present=% of 4)', n;
  END IF;

  SELECT count(*) INTO n FROM (SELECT * FROM config.config_values EXCEPT SELECT * FROM c_043) d;
  IF n <> 0 THEN
    RAISE EXCEPTION 'AC-7: down added or changed % rows', n;
  END IF;
  SELECT count(*) INTO n FROM (SELECT * FROM c_043 EXCEPT SELECT * FROM config.config_values) d;
  IF n <> 2 OR (SELECT count(*) FROM (SELECT * FROM c_043 EXCEPT SELECT * FROM config.config_values) d
                 WHERE d.namespace = 'analysis' AND d.environment = 'production' AND d.user_id IS NULL
                   AND ((d.key = 'analysis.engine.max_strategies_per_cycle' AND d.value_data = '50')
                     OR (d.key = 'analysis.engine.eval_interval_seconds' AND d.value_data = '60'))) <> 2 THEN
    RAISE EXCEPTION 'AC-7: down removed % rows (want exactly the two production seeded rows)', n;
  END IF;
END $$;

ROLLBACK;

BEGIN;

DELETE FROM config.config_values
 WHERE namespace = 'analysis'
   AND key IN ('analysis.engine.max_strategies_per_cycle', 'analysis.engine.eval_interval_seconds');

-- The interval holds the budget's seed value: a down keyed on value alone, not per key, would delete it.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('analysis', 'analysis.engine.max_strategies_per_cycle', 'int', '200', 'Operator note', '75', NULL, 'staging', NULL),
  ('analysis', 'analysis.engine.eval_interval_seconds', 'int', '50', 'Operator interval note', '45', NULL, 'staging', NULL);

\ir ../../services/xstockstrat-config/migrations/043_analysis_live_loop_keys.up.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM config.config_values
                  WHERE namespace = 'analysis' AND key = 'analysis.engine.max_strategies_per_cycle'
                    AND environment = 'staging' AND user_id IS NULL
                    AND value_data = '200' AND description = 'Operator note' AND default_value = '75'
                    AND consuming_service = 'xstockstrat-analysis' AND updated_by IS NULL) THEN
    RAISE EXCEPTION 'AC-9: staging budget operator metadata overwritten or blank consumer not filled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values
                  WHERE namespace = 'analysis' AND key = 'analysis.engine.eval_interval_seconds'
                    AND environment = 'staging' AND user_id IS NULL
                    AND value_data = '50' AND description = 'Operator interval note' AND default_value = '45'
                    AND consuming_service = 'xstockstrat-analysis' AND updated_by IS NULL) THEN
    RAISE EXCEPTION 'AC-9: staging interval operator metadata overwritten or blank consumer not filled';
  END IF;
END $$;

\ir ../../services/xstockstrat-config/migrations/043_analysis_live_loop_keys.down.sql

DO $$
DECLARE
  n BIGINT;
BEGIN
  SELECT count(*) INTO n
    FROM config.config_values
   WHERE namespace = 'analysis' AND environment = 'staging' AND user_id IS NULL
     AND key = 'analysis.engine.eval_interval_seconds' AND value_data = '50';
  IF n <> 1 THEN
    RAISE EXCEPTION 'AC-12: down deleted the staging interval holding 50 (the budget seed value) (rows=%)', n;
  END IF;

  SELECT count(*) INTO n
    FROM config.config_values
   WHERE namespace = 'analysis' AND environment = 'staging' AND user_id IS NULL
     AND key = 'analysis.engine.max_strategies_per_cycle' AND value_data = '200';
  IF n <> 1 THEN
    RAISE EXCEPTION 'AC-7: down deleted the staging budget holding 200 (rows=%)', n;
  END IF;
END $$;

ROLLBACK;
