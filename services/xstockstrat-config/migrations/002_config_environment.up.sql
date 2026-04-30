-- Migration: 002_config_environment.sql
-- Service: xstockstrat-config
-- Adds environment (dev/production) and trading_mode (paper/live/all) scoping to config values.

-- Add environment column: defaults to 'dev' for all existing rows
ALTER TABLE config.config_values
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'dev'
    CHECK (environment IN ('dev', 'production'));

-- Add trading_mode column: 'all' means the value applies to both paper and live
ALTER TABLE config.config_values
  ADD COLUMN IF NOT EXISTS trading_mode TEXT NOT NULL DEFAULT 'all'
    CHECK (trading_mode IN ('paper', 'live', 'all'));

-- Drop old unique constraint and replace with env/mode-scoped one
ALTER TABLE config.config_values
  DROP CONSTRAINT IF EXISTS config_values_namespace_key_key;

ALTER TABLE config.config_values
  ADD CONSTRAINT config_values_namespace_key_env_mode_key
    UNIQUE (namespace, key, environment, trading_mode);

-- Add composite index for efficient env/mode-scoped lookups
CREATE INDEX IF NOT EXISTS idx_config_namespace_env_mode
  ON config.config_values (namespace, environment, trading_mode);

-- Update audit table to record environment and trading_mode context
ALTER TABLE config.config_audit
  ADD COLUMN IF NOT EXISTS environment TEXT,
  ADD COLUMN IF NOT EXISTS trading_mode TEXT;

-- Update audit trigger to capture env/mode
CREATE OR REPLACE FUNCTION config.audit_config_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.value_data IS DISTINCT FROM NEW.value_data THEN
        INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode)
        VALUES (NEW.namespace, NEW.key, OLD.value_data, NEW.value_data, NEW.updated_by, NEW.update_reason, NEW.environment, NEW.trading_mode);
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Seed production variants of key trading risk values (more conservative than dev defaults)
INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode) VALUES
  -- Platform production defaults
  ('platform', 'maintenance_mode',   'bool',   'false',  'Halts all trading operations',         'false',  'all',                       'production', 'all'),
  ('platform', 'log_level',          'string', 'warn',   'Global log level',                     'warn',   'all',                       'production', 'all'),
  -- Trading: tighter risk limits for production
  ('trading',  'approval.require_above_qty',      'float',  '100',   'Order qty threshold for approval',     '100',    'xstockstrat-trading', 'production', 'live'),
  ('trading',  'approval.require_above_notional', 'float',  '10000', 'Notional threshold for approval',      '10000',  'xstockstrat-trading', 'production', 'live'),
  ('trading',  'risk.max_position_pct',           'float',  '0.02',  'Max single position % of portfolio',   '0.02',   'xstockstrat-trading', 'production', 'live'),
  ('trading',  'risk.daily_loss_limit',           'float',  '0.01',  'Halt if day loss > 1%',                '0.01',   'xstockstrat-trading', 'production', 'live'),
  -- Trading: paper prod limits (less strict than live)
  ('trading',  'approval.require_above_qty',      'float',  '500',   'Order qty threshold for approval',     '500',    'xstockstrat-trading', 'production', 'paper'),
  ('trading',  'approval.require_above_notional', 'float',  '50000', 'Notional threshold for approval',      '50000',  'xstockstrat-trading', 'production', 'paper'),
  ('trading',  'risk.max_position_pct',           'float',  '0.05',  'Max single position % of portfolio',   '0.05',   'xstockstrat-trading', 'production', 'paper'),
  ('trading',  'risk.daily_loss_limit',           'float',  '0.02',  'Halt if day loss > 2%',                '0.02',   'xstockstrat-trading', 'production', 'paper'),
  -- Indicators: same sandbox limits everywhere
  ('indicators','sandbox.timeout_ms',             'int',    '3000',  'Formula execution timeout ms',         '3000',   'xstockstrat-indicators', 'production', 'all'),
  ('indicators','sandbox.memory_bytes',           'int',    '67108864', 'Formula memory cap bytes (64MB)',   '67108864','xstockstrat-indicators','production', 'all'),
  ('indicators','sandbox.allowed_imports',        'string', 'numpy,pandas,math,statistics', 'Allowed imports','numpy,pandas,math,statistics','xstockstrat-indicators','production','all'),
  -- MarketData: live endpoint for production
  ('marketdata','alpaca.paper',                   'bool',   'false', 'Use Alpaca live endpoint',             'false',  'xstockstrat-marketdata', 'production', 'live'),
  ('marketdata','alpaca.paper',                   'bool',   'true',  'Use Alpaca paper endpoint',            'true',   'xstockstrat-marketdata', 'production', 'paper'),
  ('marketdata','backfill.batch_size',            'int',    '1000',  'Bars per API request',                 '1000',   'xstockstrat-marketdata', 'production', 'all'),
  -- Portfolio
  ('portfolio', 'snapshot.interval_minutes',      'int',    '1',     'Portfolio snapshot frequency (prod)',  '1',      'xstockstrat-portfolio',  'production', 'all'),
  -- Analysis
  ('analysis',  'backtest.max_duration_seconds',  'int',    '120',   'Max backtest wall-clock time (prod)',  '120',    'xstockstrat-analysis',   'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
