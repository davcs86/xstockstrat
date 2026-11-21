-- Migration: 048_webhook_fanout_callback_keys.down.sql
-- Service: xstockstrat-config, feature webhook-fanout-callback. The outer parentheses are load-bearing.

DELETE FROM config.config_values
WHERE environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-webhook-fanout-callback'
  AND ((namespace = 'notify' AND key = 'webhook.allowed_origins' AND value_data = '')
    OR (namespace = 'notify' AND key = 'webhook.max_attempts' AND value_data = '8')
    OR (namespace = 'notify' AND key = 'webhook.backoff_base_seconds' AND value_data = '30')
    OR (namespace = 'notify' AND key = 'webhook.backoff_max_seconds' AND value_data = '3600')
    OR (namespace = 'notify' AND key = 'webhook.request_timeout_seconds' AND value_data = '10')
    OR (namespace = 'ingest' AND key = 'backfill.webhook_sweep_interval_seconds' AND value_data = '60'));
