-- Migration: 050_ui_chart_history_bars.down.sql
-- Service: xstockstrat-config, feature fix-indicator-pane-warmup. A row an operator has changed is never deleted.

DELETE FROM config.config_values
WHERE environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-fix-indicator-pane-warmup'
  AND namespace = 'ui'
  AND key = 'chart.indicator_history_bars'
  AND value_data = '200';
