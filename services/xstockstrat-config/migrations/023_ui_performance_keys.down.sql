-- Migration: 023_ui_performance_keys.down.sql
-- Reverses 023_ui_performance_keys.up.sql — removes the two seeded ui.performance.* keys (feature 031)
-- across all environments (global rows only, matching the seed's user_id NULL scope).

DELETE FROM config.config_values
WHERE namespace = 'ui'
  AND key IN ('performance.risk_free_rate_annual', 'performance.equity_curve_start_date');
