-- Migration: 051_ingest_backfill_self_serve_keys.down.sql
-- Service: xstockstrat-config, feature backtest-inline-backfill. Deletes only the seeded rows, never an operator-changed value.

DELETE FROM config.config_values
WHERE environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-backtest-inline-backfill'
  AND namespace = 'ingest'
  AND key = 'backfill.self_serve_max_range_days'
  AND value_data = '730';
