-- Migration: 056_analysis_live_only_cycle_max_days.down.sql
-- Service: xstockstrat-config, feature opportunity-live-only-rotation. A row an operator has changed is never deleted.

DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND key = 'opportunity.live_only_cycle_max_days'
  AND environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-opportunity-live-only-rotation'
  AND value_data = '3';
