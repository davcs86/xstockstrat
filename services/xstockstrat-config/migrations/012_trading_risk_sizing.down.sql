-- Migration: 012_trading_risk_sizing.down.sql
-- Service: xstockstrat-config
-- Reverses 012_trading_risk_sizing.up.sql. Explicit key IN (...) list (not a LIKE prefix) so
-- the pre-existing, untouched trading.risk.max_position_pct key can never match.

DELETE FROM config.config_values
WHERE namespace = 'trading'
  AND key IN ('risk.max_risk_per_trade_pct', 'risk.atr_multiplier', 'risk.max_concentration_pct', 'risk.sizing_enabled');
