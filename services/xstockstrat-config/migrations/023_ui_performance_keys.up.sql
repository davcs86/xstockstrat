-- Migration: 023_ui_performance_keys.up.sql
-- Service: xstockstrat-config
-- Seeds the ui.performance.* config keys (feature 031, strategy-performance-dashboard) for
-- staging + production.
--
-- The xstockstrat-ui /insights performance dashboard reads these ONE-SHOT via
-- GetConfig(namespace='ui') — it is a stateless BFF with no WatchConfig subscription. GetConfig
-- returns a values map keyed by the `key` column (everything after the namespace), so the stored
-- `key` must equal the exact string the UI reads: values['performance.risk_free_rate_annual'] /
-- values['performance.equity_curve_start_date'] (the `platform`/`trading_state` sub-key precedent).
--
-- Both are read with an oneof-presence check (never `value || default`), so a stored 0 / empty string
-- survives: risk_free_rate 0 is a legitimate rate; equity_curve_start_date '' means "auto — earliest
-- closed-position date" (the key is still seeded so it is discoverable/settable in config-ui).
-- Scope: global (user_id NULL), one row per environment.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ui', 'performance.risk_free_rate_annual', 'float', '0.045',
   'Annualized risk-free rate for the /insights performance dashboard rolling-30d Sharpe (feature 031, FR-3). Read one-shot via GetConfig with an oneof-presence check; a stored 0 is legitimate. Default 0.045.',
   '0.045', 'xstockstrat-ui', 'staging', NULL),
  ('ui', 'performance.risk_free_rate_annual', 'float', '0.045',
   'Annualized risk-free rate for the /insights performance dashboard rolling-30d Sharpe (feature 031, FR-3). Read one-shot via GetConfig with an oneof-presence check; a stored 0 is legitimate. Default 0.045.',
   '0.045', 'xstockstrat-ui', 'production', NULL),
  ('ui', 'performance.equity_curve_start_date', 'string', '',
   'ISO date the cumulative-P&L equity curve starts from (feature 031, FR-1). Empty = auto: the UI defaults to the earliest closed-position date. Read one-shot via GetConfig; the UI treats '''' as absent.',
   '', 'xstockstrat-ui', 'staging', NULL),
  ('ui', 'performance.equity_curve_start_date', 'string', '',
   'ISO date the cumulative-P&L equity curve starts from (feature 031, FR-1). Empty = auto: the UI defaults to the earliest closed-position date. Read one-shot via GetConfig; the UI treats '''' as absent.',
   '', 'xstockstrat-ui', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
