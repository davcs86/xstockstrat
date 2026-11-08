-- config 041 (AC-3, AC-4, AC-5, AC-14, AC-15, AC-24, AC-29, AC-33): run by migration-rerun.sh after passes 0-3.
-- Runs at cfg_pre (R-1) in migration-rerun.sh pass 2c, before the feature-296 rename; it describes the pre-R state.
-- Asserts the heal of fixtures-pre-041.sql; report rows from any run count, since the AC-28 legs re-run 041.

DO $$
BEGIN
  IF to_regclass('config.config_heal_report_041') IS NULL
     OR to_regclass('config.config_values_premigration_041') IS NULL THEN
    RAISE EXCEPTION '041: config_heal_report_041 / config_values_premigration_041 missing (041 not applied)';
  END IF;
END $$;

DO $$
DECLARE
  n BIGINT;
  v TEXT;
  t TEXT;
BEGIN
  -- AC-3
  SELECT count(*), max(value_data) INTO n, v FROM config.config_values
   WHERE namespace = 'analysis' AND key = 'analysis.backtest.max_duration_seconds'
     AND environment = 'production' AND user_id IS NULL;
  IF n <> 1 OR v IS DISTINCT FROM '300' THEN
    RAISE EXCEPTION 'AC-3: production analysis.backtest.max_duration_seconds not at code default 300 (rows=%, value=%)', n, v;
  END IF;
  IF EXISTS (SELECT 1 FROM config.config_values
              WHERE namespace = 'analysis' AND key = 'backtest.max_duration_seconds'
                AND environment = 'production' AND user_id IS NULL) THEN
    RAISE EXCEPTION 'AC-3: global bare production backtest.max_duration_seconds survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_values_premigration_041
                  WHERE namespace = 'analysis' AND key = 'backtest.max_duration_seconds'
                    AND environment = 'production' AND user_id IS NULL AND value_data = '120') THEN
    RAISE EXCEPTION 'AC-3: bare production backtest.max_duration_seconds missing from config_values_premigration_041';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_heal_report_041
                  WHERE namespace = 'analysis' AND key = 'backtest.max_duration_seconds' AND environment = 'production'
                    AND user_id IS NULL AND stored_value = '120' AND effective_value = '300') THEN
    RAISE EXCEPTION 'AC-3: report lacks production backtest.max_duration_seconds stored 120, effective 300';
  END IF;

  -- AC-4
  SELECT count(*), max(value_data) INTO n, v FROM config.config_values
   WHERE namespace = 'analysis' AND key IN ('backtest.max_duration_seconds', 'analysis.backtest.max_duration_seconds')
     AND environment = 'staging' AND user_id IS NULL;
  SELECT max(key) INTO t FROM config.config_values
   WHERE namespace = 'analysis' AND key IN ('backtest.max_duration_seconds', 'analysis.backtest.max_duration_seconds')
     AND environment = 'staging' AND user_id IS NULL;
  IF n <> 1 OR v IS DISTINCT FROM '60' OR t IS DISTINCT FROM 'analysis.backtest.max_duration_seconds' THEN
    RAISE EXCEPTION 'AC-4: want one analysis.backtest.max_duration_seconds=60 (rows=%, key=%, value=%)', n, t, v;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_audit
                  WHERE namespace = 'analysis' AND key = 'backtest.max_duration_seconds'
                    AND environment = 'staging' AND user_id IS NULL AND old_value = '300'
                    AND changed_by = 'system:config-migration-041') THEN
    RAISE EXCEPTION 'AC-4: no config_audit row for the deleted backtest.max_duration_seconds';
  END IF;

  -- AC-5
  SELECT count(*), max(value_data), max(value_type) INTO n, v, t FROM config.config_values
   WHERE namespace = 'analysis' AND user_id = 'u-295' AND key = 'fundsignal.enabled' AND environment = 'staging';
  IF n <> 1 OR v IS DISTINCT FROM 'true' OR t IS DISTINCT FROM 'bool' THEN
    RAISE EXCEPTION 'AC-5: per-user u-295 fundsignal.enabled changed (rows=%, value=%, type=%)', n, v, t;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_heal_report_041
                  WHERE namespace = 'analysis' AND key = 'fundsignal.enabled' AND user_id = 'u-295') THEN
    RAISE EXCEPTION 'AC-5: per-user u-295 row not reported';
  END IF;
  IF EXISTS (SELECT 1 FROM config.config_heal_report_041
              WHERE user_id IS NOT NULL AND (stored_value IS NOT NULL OR effective_value IS NOT NULL)) THEN
    RAISE EXCEPTION 'AC-5: a per-user report row carries a stored/effective value';
  END IF;

  -- AC-14
  SELECT string_agg(format('%s (rows=%s)', e.env, c.n), '; ') INTO v
    FROM (VALUES ('staging'), ('production')) AS e(env)
   CROSS JOIN LATERAL (
     SELECT count(*) AS n,
            COALESCE(bool_and(r.value_type = 'int' AND r.value_data = '900' AND r.default_value = '900'
                              AND COALESCE(r.description, '') <> ''
                              AND r.consuming_service = 'xstockstrat-identity'), false) AS ok
       FROM config.config_values r
      WHERE r.namespace = 'identity' AND r.key = 'identity.jwt.access_ttl_seconds'
        AND r.environment = e.env AND r.user_id IS NULL
   ) AS c
   WHERE c.n <> 1 OR NOT c.ok;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'AC-14: identity.jwt.access_ttl_seconds not seeded int/900/described/xstockstrat-identity: %', v;
  END IF;

  -- AC-15
  IF NOT EXISTS (SELECT 1 FROM config.config_values
                  WHERE namespace = 'ledger' AND key = 'stream.notify_enabled'
                    AND environment = 'staging' AND user_id IS NULL) THEN
    RAISE EXCEPTION 'AC-15: dead ledger stream.notify_enabled was deleted (296 owns it)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_heal_report_041
                  WHERE namespace = 'ledger' AND key = 'stream.notify_enabled'
                    AND environment = 'staging' AND action = 'unread-no-partner') THEN
    RAISE EXCEPTION 'AC-15: ledger stream.notify_enabled not reported unread-no-partner';
  END IF;

  -- AC-24
  SELECT count(*), max(value_data), max(value_type) INTO n, v, t FROM config.config_values
   WHERE namespace = 'trading' AND key = 'trading.order.max_retries'
     AND environment = 'staging' AND user_id IS NULL;
  IF n <> 1 OR v IS DISTINCT FROM '7' OR t IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'AC-24: trading.order.max_retries changed (rows=%, value=%, type=%)', n, v, t;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_heal_report_041
                  WHERE namespace = 'trading' AND key = 'trading.order.max_retries'
                    AND environment = 'staging' AND action = 'signoff-type') THEN
    RAISE EXCEPTION 'AC-24: trading.order.max_retries not reported signoff-type';
  END IF;

  -- AC-29
  IF EXISTS (SELECT 1 FROM config.config_values
              WHERE namespace = 'platform' AND key IN ('trading_state', 'platform.trading_state')
                AND environment = 'production' AND user_id IS NULL) THEN
    RAISE EXCEPTION 'AC-29: a production platform.trading_state row was seeded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_heal_report_041
                  WHERE namespace = 'platform' AND key = 'platform.trading_state'
                    AND action = 'readers-disagree') THEN
    RAISE EXCEPTION 'AC-29: platform.trading_state not reported readers-disagree';
  END IF;

  -- AC-33
  IF NOT EXISTS (SELECT 1 FROM config.config_values
                  WHERE namespace = 'marketdata' AND key = 'marketdata.fmp.api_key'
                    AND environment = 'staging' AND user_id IS NULL AND value_data = 'legacy-fmp-value-295') THEN
    RAISE EXCEPTION 'AC-33: legacy marketdata.fmp.api_key twin was not kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_heal_report_041
                  WHERE namespace = 'marketdata' AND key = 'marketdata.fmp.api_key'
                    AND environment = 'staging' AND action = 'twin-secret-class') THEN
    RAISE EXCEPTION 'AC-33: legacy marketdata.fmp.api_key not reported twin-secret-class';
  END IF;
  IF EXISTS (SELECT 1 FROM config.config_heal_report_041
              WHERE stored_value LIKE '%legacy-fmp-value-295%' OR effective_value LIKE '%legacy-fmp-value-295%')
     OR EXISTS (SELECT 1 FROM config.config_values_premigration_041
                 WHERE value_data LIKE '%legacy-fmp-value-295%' OR default_value LIKE '%legacy-fmp-value-295%') THEN
    RAISE EXCEPTION 'AC-33: secret-class twin value leaked into the report or snapshot';
  END IF;

  -- @feature-264 @AC-5
  IF EXISTS (SELECT 1 FROM config.config_values
              WHERE namespace = 'portfolio' AND key IN ('snapshot.interval_minutes', 'portfolio.snapshot.interval_minutes')) THEN
    RAISE EXCEPTION 'feature-264 AC-5: portfolio.snapshot.interval_minutes was seeded';
  END IF;

  -- default-synced changes default_value only.
  SELECT count(*), max(value_data), max(default_value) INTO n, v, t FROM config.config_values
   WHERE namespace = 'analysis' AND key = 'analysis.engine.eval_interval_seconds'
     AND environment = 'staging' AND user_id IS NULL;
  IF n <> 1 OR v IS DISTINCT FROM '60' OR t IS DISTINCT FROM '60' THEN
    RAISE EXCEPTION 'default-synced: eval_interval_seconds want value 60 default 60 (rows=%, value=%, default=%)', n, v, t;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM config.config_heal_report_041
                  WHERE namespace = 'analysis' AND key = 'analysis.engine.eval_interval_seconds'
                    AND environment = 'staging' AND action = 'default-synced') THEN
    RAISE EXCEPTION 'default-synced: eval_interval_seconds not reported default-synced';
  END IF;
  SELECT string_agg(format('%s/%s/%s', r.namespace, r.key, r.environment), '; ') INTO v
    FROM config.config_heal_report_041 r
    JOIN config.config_values_premigration_041 s
      ON s.namespace = r.namespace AND s.key = r.key AND s.environment = r.environment
     AND COALESCE(s.user_id, '') = COALESCE(r.user_id, '')
    JOIN config.config_values c
      ON c.namespace = r.namespace AND c.key = r.key AND c.environment = r.environment
     AND COALESCE(c.user_id, '') = COALESCE(r.user_id, '')
   WHERE r.action = 'default-synced' AND c.value_data IS DISTINCT FROM s.value_data;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'default-synced changed served values: %', v;
  END IF;

  -- Unsigned twin: both spellings kept and reported.
  SELECT count(*) INTO n FROM config.config_values
   WHERE namespace = 'analysis' AND key IN ('fundsignal.valid_days', 'analysis.fundsignal.valid_days')
     AND environment = 'staging' AND user_id IS NULL;
  IF n <> 2 OR NOT EXISTS (SELECT 1 FROM config.config_heal_report_041
                            WHERE namespace = 'analysis' AND key = 'fundsignal.valid_days'
                              AND environment = 'staging' AND action = 'twin-kept-unsigned') THEN
    RAISE EXCEPTION 'unsigned twin fundsignal.valid_days deleted or unreported (rows=%)', n;
  END IF;
END $$;
