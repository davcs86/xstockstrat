-- Migration: 050_ui_chart_history_bars.up.sql
-- Service: xstockstrat-config, feature fix-indicator-pane-warmup. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('ui', 'chart.indicator_history_bars', 'int', '200',
   'The number of bars of history the trader symbol page fetches for its indicator panes (the chart still draws the latest 200). Raising it gives long-lookback indicators a full line and widens every marketdata bars read to three times this many intervals. Keep 200 on a database shared between environments (DigitalOcean). Raise it, to at most 1000, only after the lock-budget gate in docs/runbooks/ohlcv-lock-budget-tuning.md section "Homelab deep indicator history" passes.',
   '200', 'xstockstrat-ui', 'system:config-migration-feature-fix-indicator-pane-warmup', 'staging', NULL),
  ('ui', 'chart.indicator_history_bars', 'int', '200',
   'The number of bars of history the trader symbol page fetches for its indicator panes (the chart still draws the latest 200). Raising it gives long-lookback indicators a full line and widens every marketdata bars read to three times this many intervals. Keep 200 on a database shared between environments (DigitalOcean). Raise it, to at most 1000, only after the lock-budget gate in docs/runbooks/ohlcv-lock-budget-tuning.md section "Homelab deep indicator history" passes.',
   '200', 'xstockstrat-ui', 'system:config-migration-feature-fix-indicator-pane-warmup', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
