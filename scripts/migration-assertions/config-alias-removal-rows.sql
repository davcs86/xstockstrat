-- Feature 306 (AC-6): the alias-removal row migration's end state after the full chain.
-- Slug-named on purpose (not digit-led): the final sweep runs it once, and a merge-time renumber cannot collide with it.
-- Every count is scoped to the CURRENT marker's run (set_at), because pass 2e and pass 3 apply the up more than once.

-- AC-6: the latch is set by the 306 actor.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM config.config_markers
                  WHERE name = 'alias_removal_rows_306' AND set_by = 'system:config-migration-feature-306') THEN
    RAISE EXCEPTION 'AC-6: the alias_removal_rows_306 marker is absent or not set by system:config-migration-feature-306';
  END IF;
END $$;

-- AC-6: no live global row for the three keys (the ListKeys proof), and the report = snapshot = delete audit rows, 1..6.
DO $$
DECLARE
  v_set timestamptz := (SELECT set_at FROM config.config_markers WHERE name = 'alias_removal_rows_306');
  v_rep int;
  v_snap int;
  v_aud int;
BEGIN
  IF EXISTS (SELECT 1 FROM config.config_values
              WHERE user_id IS NULL AND ((namespace = 'platform' AND key = 'log_level')
                 OR (namespace = 'trading' AND key = 'risk.daily_loss_limit')
                 OR (namespace = 'ledger' AND key = 'stream.notify_enabled'))) THEN
    RAISE EXCEPTION 'AC-6: a global row of the three deleted keys is still live in config.config_values';
  END IF;
  SELECT count(*) INTO v_rep FROM config.config_keys_report_296
   WHERE action = 'alias-removal-row-deleted' AND run_at = v_set;
  SELECT count(*) INTO v_snap FROM config.config_values_premigration_296 s
    JOIN config.config_keys_report_296 r
      ON r.action = 'alias-removal-row-deleted' AND r.run_at = v_set
     AND r.namespace = s.namespace AND r.key = s.key AND r.environment = s.environment
   WHERE s.user_id IS NULL AND s.snapshot_at >= v_set AND NOT s.is_secret AND s.value_data IS NOT NULL;
  SELECT count(*) INTO v_aud FROM config.config_audit a
    JOIN config.config_values_premigration_296 s
      ON s.namespace = a.namespace AND s.key = a.key AND s.environment = a.environment
     AND s.user_id IS NULL AND s.snapshot_at >= v_set AND s.value_data = a.old_value
   WHERE a.changed_by = 'system:config-migration-feature-306' AND a.new_value IS NULL
     AND a.reason = 'feature 306: delete alias-removal row' AND a.changed_at >= v_set;
  IF v_rep < 1 OR v_rep > 6 THEN
    RAISE EXCEPTION 'AC-6: expected 1..6 alias-removal-row-deleted rows in the current run, got %', v_rep;
  END IF;
  IF v_snap <> v_rep THEN
    RAISE EXCEPTION 'AC-6: % snapshot rows for % deleted rows in the current run', v_snap, v_rep;
  END IF;
  IF v_aud <> v_rep THEN
    RAISE EXCEPTION 'AC-6: % delete audit rows (new_value NULL, old_value kept) for % deleted rows', v_aud, v_rep;
  END IF;
  RAISE NOTICE 'feature 306: % rows deleted in the current run', v_rep;
END $$;

-- AC-6: a per-user or secret row of the keys is kept and reported, never raised; the 306 migration reports no unmatched tuple.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config.config_keys_report_296
              WHERE action = 'unmatched-signed-tuple' AND reason LIKE 'feature 306:%') THEN
    RAISE EXCEPTION 'AC-6: the alias-removal migration reported an unmatched-signed-tuple row';
  END IF;
  RAISE NOTICE 'feature 306: out-of-scope rows reported in the current run: %',
    (SELECT count(*) FROM config.config_keys_report_296
      WHERE action = 'alias-removal-out-of-scope'
        AND run_at = (SELECT set_at FROM config.config_markers WHERE name = 'alias_removal_rows_306'));
END $$;

-- 305's end state is intact (its latch is still present).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM config.config_markers WHERE name = 'dead_rows_305') THEN
    RAISE EXCEPTION 'AC-6: the dead_rows_305 marker is missing after the alias-removal migration';
  END IF;
END $$;
