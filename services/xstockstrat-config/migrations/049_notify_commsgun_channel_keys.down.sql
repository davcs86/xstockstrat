-- Migration: 049_notify_commsgun_channel_keys.down.sql
-- Service: xstockstrat-config, feature notify-commsgun-channel. The outer parentheses are load-bearing.
-- A secret that has been set (value_encrypted not NULL) is never deleted.

DELETE FROM config.config_values
WHERE environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-notify-commsgun-channel'
  AND ((namespace = 'notify' AND key = 'fanout.email_provider' AND value_data = 'auto')
    OR (namespace = 'notify' AND key = 'commsgun.enqueue_url' AND value_data = '')
    OR (namespace = 'notify' AND key = 'commsgun.app_id' AND environment = 'staging' AND value_data = 'xstockstrat-staging')
    OR (namespace = 'notify' AND key = 'commsgun.app_id' AND environment = 'production' AND value_data = 'xstockstrat')
    OR (namespace = 'notify' AND key = 'commsgun.to_email' AND value_data = '')
    OR (namespace = 'notify' AND key = 'commsgun.max_attempts' AND value_data = '8')
    OR (namespace = 'notify' AND key = 'commsgun.backoff_base_seconds' AND value_data = '30')
    OR (namespace = 'notify' AND key = 'commsgun.backoff_max_seconds' AND value_data = '3600')
    OR (namespace = 'notify' AND key = 'commsgun.request_timeout_seconds' AND value_data = '10')
    OR (namespace = 'notify' AND key = 'commsgun.app_key' AND is_secret AND value_encrypted IS NULL));
