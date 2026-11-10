-- Feature 305 (AC-1, AC-2, AC-6): the dead-row migration's end state after the full chain.
-- Every count is scoped to the CURRENT marker's run (set_at), because pass 2d and pass 3 apply the up more than once.
-- The signed set is 4 tuples (dead 2 in scripts/config-wiring.test.mjs pins that count).

-- AC-6: the latch is set by the 305 actor.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM config.config_markers
                  WHERE name = 'dead_rows_305' AND set_by = 'system:config-migration-feature-305') THEN
    RAISE EXCEPTION 'AC-6: the dead_rows_305 marker is absent or not set by system:config-migration-feature-305';
  END IF;
END $$;

-- AC-1: the config_values table is what ListKeys reads, so "no live global row" is the ListKeys proof;
-- one dead-row-deleted report row per signed tuple, written in the marker's run.
DO $$
DECLARE
  v_set timestamptz := (SELECT set_at FROM config.config_markers WHERE name = 'dead_rows_305');
BEGIN
  IF (SELECT count(*) FROM config.config_keys_report_296 WHERE action = 'dead-row-deleted' AND run_at = v_set) <> 4 THEN
    RAISE EXCEPTION 'AC-1: expected 4 dead-row-deleted report rows in the current run';
  END IF;
  IF EXISTS (SELECT 1 FROM config.config_values v
               JOIN config.config_keys_report_296 r
                 ON r.action = 'dead-row-deleted' AND r.run_at = v_set
                AND r.namespace = v.namespace AND r.key = v.key AND r.environment = v.environment
              WHERE v.user_id IS NULL) THEN
    RAISE EXCEPTION 'AC-1: a deleted signed row is still live in config.config_values';
  END IF;
END $$;

-- AC-2: a signed tuple that matched no row is reported, never raised; none did on the fresh schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config.config_keys_report_296
              WHERE action = 'unmatched-signed-tuple' AND reason LIKE 'feature 305:%') THEN
    RAISE EXCEPTION 'AC-2: the dead-row migration reported an unmatched-signed-tuple row on the fresh schema';
  END IF;
END $$;

-- AC-1: every deleted row was snapshotted before the audit row, and the audit row records the deleted value.
DO $$
DECLARE
  v_set timestamptz := (SELECT set_at FROM config.config_markers WHERE name = 'dead_rows_305');
BEGIN
  IF (SELECT count(*) FROM config.config_values_premigration_296 s
        JOIN config.config_keys_report_296 r
          ON r.action = 'dead-row-deleted' AND r.run_at = v_set
         AND r.namespace = s.namespace AND r.key = s.key AND r.environment = s.environment
       WHERE s.user_id IS NULL AND s.snapshot_at >= v_set AND NOT s.is_secret AND s.value_data IS NOT NULL) <> 4 THEN
    RAISE EXCEPTION 'AC-1: expected 4 snapshot rows in the current run';
  END IF;
  IF (SELECT count(*) FROM config.config_audit a
        JOIN config.config_values_premigration_296 s
          ON s.namespace = a.namespace AND s.key = a.key AND s.environment = a.environment
         AND s.user_id IS NULL AND s.snapshot_at >= v_set AND s.value_data = a.old_value
       WHERE a.changed_by = 'system:config-migration-feature-305' AND a.new_value IS NULL
         AND a.reason = 'feature 305: delete signed dead row' AND a.changed_at >= v_set) <> 4 THEN
    RAISE EXCEPTION 'AC-1: expected exactly 4 delete audit rows (new_value NULL) matching the snapshots';
  END IF;
  IF EXISTS (SELECT 1 FROM config.config_audit a
              WHERE a.changed_by = 'system:config-migration-feature-305' AND a.new_value IS NULL
                AND a.changed_at >= v_set AND a.old_value IS NULL) THEN
    RAISE EXCEPTION 'AC-1: a delete audit row lost its old_value';
  END IF;
END $$;

-- AC-10: feature 305 never audits ledger/stream.notify_enabled (the row itself is deleted by feature 306).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config.config_audit
              WHERE namespace = 'ledger' AND key = 'stream.notify_enabled'
                AND changed_by = 'system:config-migration-feature-305') THEN
    RAISE EXCEPTION 'AC-10: the dead-row migration wrote an audit row for the kept ledger key';
  END IF;
END $$;

-- Reported, not asserted: per-user rows of the two signed keys are never deleted (the up excludes user_id NOT NULL).
DO $$
BEGIN
  RAISE NOTICE 'feature 305: per-user rows left for the signed keys: %',
    (SELECT count(*) FROM config.config_values
      WHERE user_id IS NOT NULL
        AND ((namespace = 'analysis' AND key = 'opportunity.sparkline_bars')
          OR (namespace = 'marketdata' AND key = 'alpaca.paper')));
END $$;
