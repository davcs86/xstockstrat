-- Rollback: 013_trading_risk_bracket.sql
DELETE FROM config.config_values
WHERE namespace = 'trading'
  AND key IN ('risk.bracket_orders_enabled', 'risk.take_profit_rr_multiple', 'risk.max_unprotected_seconds');
