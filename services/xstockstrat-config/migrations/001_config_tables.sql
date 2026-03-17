-- Migration: 001_config_tables.sql
-- Service: xstockstrat-config

CREATE SCHEMA IF NOT EXISTS config;

CREATE TABLE IF NOT EXISTS config.config_values (
    id              BIGSERIAL       PRIMARY KEY,
    namespace       TEXT            NOT NULL,
    key             TEXT            NOT NULL,
    value_type      TEXT            NOT NULL DEFAULT 'string' CHECK (value_type IN ('string','int','float','bool','json')),
    value_data      TEXT            NOT NULL,
    is_secret       BOOLEAN         NOT NULL DEFAULT FALSE,
    description     TEXT,
    default_value   TEXT,
    consuming_service TEXT,
    updated_by      TEXT,
    update_reason   TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_config_namespace ON config.config_values (namespace);

-- Audit log of all config changes
CREATE TABLE IF NOT EXISTS config.config_audit (
    id              BIGSERIAL       PRIMARY KEY,
    namespace       TEXT            NOT NULL,
    key             TEXT            NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    changed_by      TEXT,
    reason          TEXT,
    changed_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION config.audit_config_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.value_data IS DISTINCT FROM NEW.value_data THEN
        INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason)
        VALUES (NEW.namespace, NEW.key, OLD.value_data, NEW.value_data, NEW.updated_by, NEW.update_reason);
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER config_value_audit
    BEFORE UPDATE ON config.config_values
    FOR EACH ROW EXECUTE FUNCTION config.audit_config_change();

-- Seed platform-wide defaults
INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service) VALUES
  ('platform', 'maintenance_mode',   'bool',   'false',               'Halts all trading operations',         'false',  'all'),
  ('platform', 'log_level',          'string', 'info',                'Global log level',                     'info',   'all'),
  ('trading',  'approval.require_above_qty',      'float',  '500',   'Order qty threshold for approval',     '500',    'xstockstrat-trading'),
  ('trading',  'approval.require_above_notional', 'float',  '50000', 'Notional threshold for approval',      '50000',  'xstockstrat-trading'),
  ('trading',  'risk.max_position_pct',           'float',  '0.05',  'Max single position % of portfolio',   '0.05',   'xstockstrat-trading'),
  ('trading',  'risk.daily_loss_limit',           'float',  '0.02',  'Halt if day loss > 2%',                '0.02',   'xstockstrat-trading'),
  ('indicators','sandbox.timeout_ms',             'int',    '5000',  'Formula execution timeout ms',         '5000',   'xstockstrat-indicators'),
  ('indicators','sandbox.memory_bytes',           'int',    '134217728', 'Formula memory cap bytes',         '134217728','xstockstrat-indicators'),
  ('indicators','sandbox.allowed_imports',        'string', 'numpy,pandas,math,statistics', 'Allowed imports','numpy,pandas,math,statistics','xstockstrat-indicators'),
  ('ledger',   'stream.notify_enabled',           'bool',   'true',  'Enable pg NOTIFY streaming',           'true',   'xstockstrat-ledger'),
  ('marketdata','alpaca.paper',                   'bool',   'true',  'Use Alpaca paper endpoint',            'true',   'xstockstrat-marketdata'),
  ('marketdata','backfill.batch_size',            'int',    '1000',  'Bars per API request',                 '1000',   'xstockstrat-marketdata'),
  ('portfolio', 'snapshot.interval_minutes',      'int',    '5',     'Portfolio snapshot frequency',         '5',      'xstockstrat-portfolio'),
  ('analysis',  'backtest.max_duration_seconds',  'int',    '300',   'Max backtest wall-clock time',         '300',    'xstockstrat-analysis')
ON CONFLICT (namespace, key) DO NOTHING;
