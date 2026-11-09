-- Migration: 043_analysis_live_loop_keys.up.sql
-- Service: xstockstrat-config, feature 293 (fix-analysis-live-loop-budget-seed).
-- Seeds analysis.engine.max_strategies_per_cycle and analysis.engine.eval_interval_seconds for staging + production.
--
-- `key` must equal the full dotted string the live loop's int_positive reads (namespace `analysis`), and
-- value_type must be 'int': a 'string' row makes the reader silently return the code default.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('analysis', 'analysis.engine.max_strategies_per_cycle', 'int', '50',
   'Most (strategy, symbol) pairs the live strategy loop evaluates per cycle. When more pairs are live, the loop rotates through them across cycles, so each pair is re-evaluated less often; raising it lengthens each cycle.',
   '50', 'xstockstrat-analysis', 'system:config-migration-043', 'staging', NULL),
  ('analysis', 'analysis.engine.max_strategies_per_cycle', 'int', '50',
   'Most (strategy, symbol) pairs the live strategy loop evaluates per cycle. When more pairs are live, the loop rotates through them across cycles, so each pair is re-evaluated less often; raising it lengthens each cycle.',
   '50', 'xstockstrat-analysis', 'system:config-migration-043', 'production', NULL),
  ('analysis', 'analysis.engine.eval_interval_seconds', 'int', '60',
   'Seconds the live strategy loop waits after finishing a cycle before starting the next. Raising it delays live entry and exit alerts.',
   '60', 'xstockstrat-analysis', 'system:config-migration-043', 'staging', NULL),
  ('analysis', 'analysis.engine.eval_interval_seconds', 'int', '60',
   'Seconds the live strategy loop waits after finishing a cycle before starting the next. Raising it delays live entry and exit alerts.',
   '60', 'xstockstrat-analysis', 'system:config-migration-043', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;

-- Metadata-only backfill for a pre-existing (runtime-created) row: never touches value_data,
-- value_type or updated_by; the WHERE guard makes a second apply a no-op.
UPDATE config.config_values
SET description = COALESCE(NULLIF(description, ''), 'Most (strategy, symbol) pairs the live strategy loop evaluates per cycle. When more pairs are live, the loop rotates through them across cycles, so each pair is re-evaluated less often; raising it lengthens each cycle.'),
    default_value = COALESCE(NULLIF(default_value, ''), '50'),
    consuming_service = COALESCE(NULLIF(consuming_service, ''), 'xstockstrat-analysis')
WHERE namespace = 'analysis'
  AND key = 'analysis.engine.max_strategies_per_cycle'
  AND user_id IS NULL
  AND environment IN ('staging', 'production')
  AND (NULLIF(description, '') IS NULL OR NULLIF(default_value, '') IS NULL OR NULLIF(consuming_service, '') IS NULL);

UPDATE config.config_values
SET description = COALESCE(NULLIF(description, ''), 'Seconds the live strategy loop waits after finishing a cycle before starting the next. Raising it delays live entry and exit alerts.'),
    default_value = COALESCE(NULLIF(default_value, ''), '60'),
    consuming_service = COALESCE(NULLIF(consuming_service, ''), 'xstockstrat-analysis')
WHERE namespace = 'analysis'
  AND key = 'analysis.engine.eval_interval_seconds'
  AND user_id IS NULL
  AND environment IN ('staging', 'production')
  AND (NULLIF(description, '') IS NULL OR NULLIF(default_value, '') IS NULL OR NULLIF(consuming_service, '') IS NULL);
