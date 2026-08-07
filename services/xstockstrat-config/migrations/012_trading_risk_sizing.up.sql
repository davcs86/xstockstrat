-- Migration: 012_trading_risk_sizing.up.sql
-- Service: xstockstrat-config
-- Seeds the trading.risk.* position-sizing config keys (feature 023) for dev + production.
-- NOTE: numbered 012 — 011_platform_trading_state (feature 100) claimed 011 first off the
-- same 010 tip; see docs/roadmap/features/merge-order.md.
-- trading_mode='all' for every row (no paper/live split, per the product spec). The
-- pre-existing, unrelated trading.risk.max_position_pct key (warn-only, checkPortfolioRisk)
-- is deliberately not touched here — it stays alongside the new enforcing
-- max_concentration_pct (disjoint order populations: override-mode vs. auto-sized).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('trading', 'risk.max_risk_per_trade_pct', 'float', '0.02', 'Fraction of equity to risk per trade (auto-sized orders only)', '0.02', 'xstockstrat-trading', 'dev', 'all'),
  ('trading', 'risk.max_risk_per_trade_pct', 'float', '0.02', 'Fraction of equity to risk per trade (auto-sized orders only)', '0.02', 'xstockstrat-trading', 'production', 'all'),

  ('trading', 'risk.atr_multiplier', 'float', '1.5', 'Stop distance as a multiple of ATR(14)', '1.5', 'xstockstrat-trading', 'dev', 'all'),
  ('trading', 'risk.atr_multiplier', 'float', '1.5', 'Stop distance as a multiple of ATR(14)', '1.5', 'xstockstrat-trading', 'production', 'all'),

  ('trading', 'risk.max_concentration_pct', 'float', '0.10', 'Max fraction of equity in any single auto-sized position (enforcing cap)', '0.10', 'xstockstrat-trading', 'dev', 'all'),
  ('trading', 'risk.max_concentration_pct', 'float', '0.10', 'Max fraction of equity in any single auto-sized position (enforcing cap)', '0.10', 'xstockstrat-trading', 'production', 'all'),

  ('trading', 'risk.sizing_enabled', 'bool', 'true', 'Master gate for automatic position sizing; false rejects orders submitted without an explicit qty', 'true', 'xstockstrat-trading', 'dev', 'all'),
  ('trading', 'risk.sizing_enabled', 'bool', 'true', 'Master gate for automatic position sizing; false rejects orders submitted without an explicit qty', 'true', 'xstockstrat-trading', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
