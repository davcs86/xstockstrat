-- Migration: 011_platform_trading_state.sql
-- Service: xstockstrat-config
-- Feature 100 (account-trading-halt-and-kill-switch): a new PARALLEL kill-switch enum,
-- independent of platform.maintenance_mode (which stays untouched — widening its
-- value_type in place was rejected in design.md as a confirmed fail-open bug on a
-- proto oneof type mismatch). Seeded per trading_mode (not 'all') so an operator can
-- halt live trading during an incident while paper testing continues unaffected.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('platform', 'trading_state', 'string', 'ACTIVE',
   'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED. REDUCE_ONLY rejects exposure-increasing orders but permits cancellation and risk-reducing closes; HALTED rejects all exposure-increasing orders. Independent of platform.maintenance_mode.',
   'ACTIVE', 'xstockstrat-trading', 'dev', 'paper'),
  ('platform', 'trading_state', 'string', 'ACTIVE',
   'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED. REDUCE_ONLY rejects exposure-increasing orders but permits cancellation and risk-reducing closes; HALTED rejects all exposure-increasing orders. Independent of platform.maintenance_mode.',
   'ACTIVE', 'xstockstrat-trading', 'dev', 'live'),
  ('platform', 'trading_state', 'string', 'ACTIVE',
   'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED. REDUCE_ONLY rejects exposure-increasing orders but permits cancellation and risk-reducing closes; HALTED rejects all exposure-increasing orders. Independent of platform.maintenance_mode.',
   'ACTIVE', 'xstockstrat-trading', 'production', 'paper'),
  ('platform', 'trading_state', 'string', 'ACTIVE',
   'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED. REDUCE_ONLY rejects exposure-increasing orders but permits cancellation and risk-reducing closes; HALTED rejects all exposure-increasing orders. Independent of platform.maintenance_mode.',
   'ACTIVE', 'xstockstrat-trading', 'production', 'live')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
