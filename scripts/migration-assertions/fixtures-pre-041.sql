-- Pre-041 config rows, loaded by migration-rerun.sh with config at 040; config-041.sql asserts the heal.
-- Not an assertion file: migration-rerun.sh skips fixtures-* in its assertion loop.

-- Clear every scope the fixtures own, so earlier seeds and heals cannot change what 041 sees.
DELETE FROM config.config_values
 WHERE (namespace = 'analysis' AND key IN ('fundsignal.enabled', 'analysis.fundsignal.enabled',
                                           'backtest.max_duration_seconds', 'analysis.backtest.max_duration_seconds',
                                           'fundsignal.valid_days', 'analysis.fundsignal.valid_days',
                                           'engine.eval_interval_seconds', 'analysis.engine.eval_interval_seconds')
        AND user_id IS NULL AND environment IN ('staging', 'production'))
    OR (namespace = 'analysis' AND user_id = 'u-295')
    OR (namespace = 'marketdata' AND key IN ('fmp.api_key', 'marketdata.fmp.api_key')
        AND environment = 'staging' AND user_id IS NULL)
    OR (namespace = 'platform' AND key IN ('trading_state', 'platform.trading_state')
        AND environment = 'production' AND user_id IS NULL)
    OR (namespace = 'trading' AND key IN ('order.max_retries', 'trading.order.max_retries')
        AND environment = 'staging' AND user_id IS NULL)
    OR (namespace = 'identity' AND key IN ('jwt.access_ttl_seconds', 'identity.jwt.access_ttl_seconds'))
    OR (namespace = 'ledger' AND key IN ('stream.notify_enabled', 'ledger.stream.notify_enabled')
        AND environment = 'staging' AND user_id IS NULL);

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service,
   environment, user_id, updated_by)
VALUES
  -- AC-3: signed bare twin (G2 tuple); 041 seeds analysis.backtest.max_duration_seconds=300, then deletes this row.
  ('analysis', 'backtest.max_duration_seconds', 'int', '120', FALSE, 'Max backtest wall-clock time', '300',
   'xstockstrat-analysis', 'production', NULL, 'fixture-295'),
  -- AC-4: allowlisted unread twin beside the read spelling; only the 60 row may survive.
  ('analysis', 'backtest.max_duration_seconds', 'int', '300', FALSE, 'Max backtest wall-clock time', '300',
   'xstockstrat-analysis', 'staging', NULL, 'fixture-295'),
  ('analysis', 'analysis.backtest.max_duration_seconds', 'int', '60', FALSE, 'Max backtest wall-clock time', '300',
   'xstockstrat-analysis', 'staging', NULL, 'fixture-295'),
  -- AC-5: per-user unread twin, not allowlisted (per-user rows are never deleted).
  ('analysis', 'fundsignal.enabled', 'bool', 'true', FALSE, 'Master gate (per-user)', 'false',
   'xstockstrat-analysis', 'staging', 'u-295', 'fixture-295'),
  -- Unsigned twin: catalog partner present, tuple absent from allow_041.
  ('analysis', 'fundsignal.valid_days', 'int', '45', FALSE, 'Signal validity days (bare)', '90',
   'xstockstrat-analysis', 'staging', NULL, 'fixture-295'),
  ('analysis', 'analysis.fundsignal.valid_days', 'int', '90', FALSE, 'Signal validity days', '90',
   'xstockstrat-analysis', 'staging', NULL, 'fixture-295'),
  -- AC-33: the catalog spelling is the secret; the legacy non-secret twin is secret-class.
  ('marketdata', 'fmp.api_key', 'string', '[redacted]', TRUE, 'FMP API key (encrypted secret)', '',
   'xstockstrat-marketdata', 'staging', NULL, 'fixture-295'),
  ('marketdata', 'marketdata.fmp.api_key', 'string', 'legacy-fmp-value-295', FALSE, 'Legacy FMP key', '',
   'xstockstrat-marketdata', 'staging', NULL, 'fixture-295'),
  -- AC-24: string "7" is not the code default 3, so it is reported signoff-type, never retyped.
  ('trading', 'trading.order.max_retries', 'string', '7', FALSE, 'Order retry budget', '3',
   'xstockstrat-trading', 'staging', NULL, 'fixture-295'),
  -- Mismatching default_value: 041 syncs it to 60 and must leave value_data alone.
  ('analysis', 'analysis.engine.eval_interval_seconds', 'int', '60', FALSE, 'Live loop interval', '45',
   'xstockstrat-analysis', 'staging', NULL, 'fixture-295'),
  -- AC-15: dead row (no reader, no partner); 041 reports it and keeps it for 296.
  ('ledger', 'stream.notify_enabled', 'bool', 'true', FALSE, 'Enable pg NOTIFY streaming', 'true',
   'xstockstrat-ledger', 'staging', NULL, 'fixture-295');

-- The AC-3 and AC-4 deletions rely on G2-signed allow_041 tuples (production 120, staging 300), not fixture tuples:
-- a fixture tuple would also sign the row on every real database 041 runs on.
