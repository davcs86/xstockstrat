-- config 031 (AC-1, AC-3, AC-4, AC-5): run by migration-rerun.sh after passes 0-3.
-- Replays the historical 031 up-file: a later migration changing these rows or config_values columns must update or retire this file.

DO $$
DECLARE
  bare BIGINT;
  bad TEXT;
BEGIN
  SELECT count(*) INTO bare
    FROM config.config_values
   WHERE namespace = 'indicators'
     AND key IN ('sandbox.timeout_ms', 'sandbox.memory_bytes', 'sandbox.allowed_imports');
  IF bare <> 0 THEN
    RAISE EXCEPTION 'AC-1: % bare indicators sandbox.* rows remain', bare;
  END IF;

  SELECT string_agg(format('%s/%s (rows=%s value=%s type=%s)', e.env, w.key, c.n, c.vals, c.types), '; ')
    INTO bad
    FROM (VALUES ('production'), ('staging')) AS e(env)
   CROSS JOIN (VALUES
       ('indicators.sandbox.timeout_ms', '5000', 'int'),
       ('indicators.sandbox.memory_bytes', '134217728', 'int'),
       ('indicators.sandbox.allowed_imports', 'numpy,pandas,math,statistics', 'string')
     ) AS w(key, val, vtype)
   CROSS JOIN LATERAL (
     SELECT count(*) AS n,
            string_agg(v.value_data, ',') AS vals,
            string_agg(v.value_type, ',') AS types,
            COALESCE(bool_and(v.value_data = w.val AND v.value_type = w.vtype), false) AS ok
       FROM config.config_values v
      WHERE v.namespace = 'indicators' AND v.key = w.key
        AND v.environment = e.env AND v.user_id IS NULL
   ) AS c
   WHERE c.n <> 1 OR NOT c.ok;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'AC-1: global full-dotted sandbox rows wrong: %', bad;
  END IF;
END $$;

DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(format('%s (rows=%s)', e.env, c.n), '; ')
    INTO bad
    FROM (VALUES ('production'), ('staging')) AS e(env)
   CROSS JOIN LATERAL (
     SELECT count(*) AS n,
            COALESCE(bool_and(COALESCE(v.description, '') LIKE '%headroom%'
                     AND COALESCE(v.description, '') LIKE '%VmData%'
                     AND COALESCE(v.description, '') NOT ILIKE '%memory cap%'
                     AND COALESCE(v.description, '') NOT LIKE '%64MB%'), false) AS ok
       FROM config.config_values v
      WHERE v.namespace = 'indicators' AND v.key = 'indicators.sandbox.memory_bytes'
        AND v.environment = e.env AND v.user_id IS NULL
   ) AS c
   WHERE c.n <> 1 OR NOT c.ok;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'AC-3: memory_bytes row missing or description not headroom/VmData (or says memory cap / 64MB): %', bad;
  END IF;
END $$;

BEGIN;

UPDATE config.config_values SET value_data = '4000'
 WHERE namespace = 'indicators' AND key = 'indicators.sandbox.timeout_ms'
   AND environment = 'production' AND user_id IS NULL;
DELETE FROM config.config_values
 WHERE namespace = 'indicators'
   AND key IN ('indicators.sandbox.memory_bytes', 'indicators.sandbox.allowed_imports')
   AND environment = 'production' AND user_id IS NULL;
DELETE FROM config.config_values
 WHERE namespace = 'indicators' AND key = 'indicators.sandbox.memory_bytes'
   AND environment = 'staging' AND user_id IS NULL;

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('indicators', 'sandbox.timeout_ms', 'int', '3000', 'Formula execution timeout ms', '3000',
   'xstockstrat-indicators', 'production', NULL),
  ('indicators', 'sandbox.memory_bytes', 'int', '67108864', 'Formula memory cap bytes (64MB)', '67108864',
   'xstockstrat-indicators', 'production', NULL),
  ('indicators', 'sandbox.allowed_imports', 'string', 'numpy,pandas,math,statistics', 'Allowed imports',
   'numpy,pandas,math,statistics', 'xstockstrat-indicators', 'production', NULL),
  ('indicators', 'sandbox.memory_bytes', 'int', '67108864', 'Formula memory cap bytes', '67108864',
   'xstockstrat-indicators', 'staging', NULL),
  ('indicators', 'indicators.sandbox.memory_bytes', 'int', '100663296', 'Formula memory cap bytes', '100663296',
   'xstockstrat-indicators', 'staging', 'u-243'),
  ('indicators', 'sandbox.memory_bytes', 'int', '67108864', 'Formula memory cap bytes', '67108864',
   'xstockstrat-indicators', 'staging', 'u-243'),
  ('indicators', 'sandbox.timeout_ms', 'int', '2500', 'Formula execution timeout ms', '2500',
   'xstockstrat-indicators', 'staging', 'u-243b');

CREATE TEMP TABLE b031 AS SELECT * FROM config.config_values;

\ir ../../services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.up.sql

DO $$
DECLARE
  n BIGINT;
  v TEXT;
BEGIN
  SELECT count(*), max(value_data) INTO n, v
    FROM config.config_values
   WHERE namespace = 'indicators' AND key = 'indicators.sandbox.timeout_ms'
     AND environment = 'production' AND user_id IS NULL;
  IF n <> 1 OR v IS DISTINCT FROM '4000' THEN
    RAISE EXCEPTION 'AC-5: production global timeout_ms twin not kept (rows=%, value=%)', n, v;
  END IF;

  SELECT count(*) INTO n
    FROM config.config_values
   WHERE namespace = 'indicators'
     AND key IN ('sandbox.timeout_ms', 'sandbox.memory_bytes', 'sandbox.allowed_imports');
  IF n <> 0 THEN
    RAISE EXCEPTION 'AC-4: % bare sandbox.* rows survived the replay', n;
  END IF;

  IF (SELECT count(*) FROM config.config_values
       WHERE namespace = 'indicators' AND environment = 'production' AND user_id IS NULL
         AND ((key = 'indicators.sandbox.memory_bytes' AND value_data = '134217728')
           OR (key = 'indicators.sandbox.allowed_imports' AND value_data = 'numpy,pandas,math,statistics'))) <> 2 THEN
    RAISE EXCEPTION 'AC-4: production global memory_bytes/allowed_imports not healed to 134217728 / seed imports';
  END IF;

  SELECT count(*), max(value_data) INTO n, v
    FROM config.config_values
   WHERE namespace = 'indicators' AND key = 'indicators.sandbox.memory_bytes'
     AND environment = 'staging' AND user_id IS NULL;
  IF n <> 1 OR v IS DISTINCT FROM '134217728' THEN
    RAISE EXCEPTION 'AC-4: staging global memory_bytes not renamed and set (rows=%, value=%)', n, v;
  END IF;

  SELECT count(*), max(value_data) INTO n, v
    FROM config.config_values
   WHERE namespace = 'indicators' AND user_id = 'u-243'
     AND key IN ('sandbox.memory_bytes', 'indicators.sandbox.memory_bytes');
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM config.config_values
                            WHERE namespace = 'indicators' AND user_id = 'u-243'
                              AND key = 'indicators.sandbox.memory_bytes' AND value_data = '100663296') THEN
    RAISE EXCEPTION 'AC-5: per-user u-243 memory_bytes twin not kept (rows=%, value=%)', n, v;
  END IF;

  SELECT count(*), max(value_data) INTO n, v
    FROM config.config_values
   WHERE namespace = 'indicators' AND user_id = 'u-243b' AND key = 'indicators.sandbox.timeout_ms';
  IF n <> 1 OR v IS DISTINCT FROM '2500' THEN
    RAISE EXCEPTION 'AC-4: per-user u-243b timeout_ms not renamed with value kept (rows=%, value=%)', n, v;
  END IF;

  SELECT count(*) INTO n FROM (
    (SELECT * FROM config.config_values WHERE NOT (namespace = 'indicators' AND key LIKE '%sandbox.%')
     EXCEPT SELECT * FROM b031 WHERE NOT (namespace = 'indicators' AND key LIKE '%sandbox.%'))
    UNION ALL
    (SELECT * FROM b031 WHERE NOT (namespace = 'indicators' AND key LIKE '%sandbox.%')
     EXCEPT SELECT * FROM config.config_values WHERE NOT (namespace = 'indicators' AND key LIKE '%sandbox.%'))
  ) d;
  IF n <> 0 THEN
    RAISE EXCEPTION 'AC-4: replay changed % rows outside indicators sandbox.*', n;
  END IF;
END $$;

ROLLBACK;
