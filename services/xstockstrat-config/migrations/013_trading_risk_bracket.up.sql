-- Migration: 013_trading_risk_bracket.sql
-- Service: xstockstrat-config
-- Feature 030 (stop-loss-bracket-orders). NOTE: numbered 013 — 011 is
-- feature 100 (platform_trading_state), 012 is feature 023 (trading_risk_sizing).
-- bracket_orders_enabled seeds FALSE in production (not the product spec's literal
-- `true` default) pending feature 103 or a documented manual paper verification —
-- see design.md § Rejected Alternatives.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('trading', 'risk.bracket_orders_enabled', 'bool', 'true', 'Master gate for automatic stop-loss/take-profit bracket orders on auto-sized entries', 'true', 'xstockstrat-trading', 'dev', 'all'),
  ('trading', 'risk.bracket_orders_enabled', 'bool', 'false', 'Master gate for automatic stop-loss/take-profit bracket orders on auto-sized entries — FALSE pending feature 103 or a documented manual verification', 'false', 'xstockstrat-trading', 'production', 'all'),

  ('trading', 'risk.take_profit_rr_multiple', 'float', '2.0', 'Reward-to-risk multiple for the take-profit leg; 0 disables the take-profit leg', '2.0', 'xstockstrat-trading', 'dev', 'all'),
  ('trading', 'risk.take_profit_rr_multiple', 'float', '2.0', 'Reward-to-risk multiple for the take-profit leg; 0 disables the take-profit leg', '2.0', 'xstockstrat-trading', 'production', 'all'),

  ('trading', 'risk.max_unprotected_seconds', 'int', '30', 'Provisional default — max seconds an auto-sized position may remain without a confirmed bracket before automatic flatten+halt', '30', 'xstockstrat-trading', 'dev', 'all'),
  ('trading', 'risk.max_unprotected_seconds', 'int', '30', 'Provisional default — max seconds an auto-sized position may remain without a confirmed bracket before automatic flatten+halt', '30', 'xstockstrat-trading', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
