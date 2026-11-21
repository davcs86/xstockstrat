-- Migration: 048_webhook_fanout_callback_keys.up.sql
-- Service: xstockstrat-config, feature webhook-fanout-callback. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('notify', 'webhook.allowed_origins', 'string', '',
   'Origins that webhook callback URLs may target: comma-separated host[:port] entries, https only, a missing port means 443. A callback URL is accepted and delivered only when its host and port equal one entry exactly. Empty rejects every callback URL.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'staging', NULL),
  ('notify', 'webhook.allowed_origins', 'string', '',
   'Origins that webhook callback URLs may target: comma-separated host[:port] entries, https only, a missing port means 443. A callback URL is accepted and delivered only when its host and port equal one entry exactly. Empty rejects every callback URL.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'production', NULL),
  ('notify', 'webhook.max_attempts', 'int', '8',
   'Delivery attempts a webhook gets before it is marked dead and an alert is raised. Raising it keeps retrying an unreachable receiver for longer.',
   '8', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'staging', NULL),
  ('notify', 'webhook.max_attempts', 'int', '8',
   'Delivery attempts a webhook gets before it is marked dead and an alert is raised. Raising it keeps retrying an unreachable receiver for longer.',
   '8', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'production', NULL),
  ('notify', 'webhook.backoff_base_seconds', 'int', '30',
   'Seconds before the first webhook retry; each later retry doubles the wait, up to webhook.backoff_max_seconds. Raising it slows every retry.',
   '30', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'staging', NULL),
  ('notify', 'webhook.backoff_base_seconds', 'int', '30',
   'Seconds before the first webhook retry; each later retry doubles the wait, up to webhook.backoff_max_seconds. Raising it slows every retry.',
   '30', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'production', NULL),
  ('notify', 'webhook.backoff_max_seconds', 'int', '3600',
   'Longest wait in seconds between two webhook delivery attempts. Lowering it retries a failing receiver more often.',
   '3600', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'staging', NULL),
  ('notify', 'webhook.backoff_max_seconds', 'int', '3600',
   'Longest wait in seconds between two webhook delivery attempts. Lowering it retries a failing receiver more often.',
   '3600', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'production', NULL),
  ('notify', 'webhook.request_timeout_seconds', 'int', '10',
   'Seconds a webhook delivery request may take before it counts as a failed attempt. Clamped to 1-60.',
   '10', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'staging', NULL),
  ('notify', 'webhook.request_timeout_seconds', 'int', '10',
   'Seconds a webhook delivery request may take before it counts as a failed attempt. Clamped to 1-60.',
   '10', 'xstockstrat-notify', 'system:config-migration-feature-webhook-fanout-callback', 'production', NULL),
  ('ingest', 'backfill.webhook_sweep_interval_seconds', 'int', '60',
   'Seconds between sweeps that hand finished backfill jobs with a callback URL to notify. A finishing job also wakes the sweep, so this bounds how soon a failed hand-off is retried.',
   '60', 'xstockstrat-ingest', 'system:config-migration-feature-webhook-fanout-callback', 'staging', NULL),
  ('ingest', 'backfill.webhook_sweep_interval_seconds', 'int', '60',
   'Seconds between sweeps that hand finished backfill jobs with a callback URL to notify. A finishing job also wakes the sweep, so this bounds how soon a failed hand-off is retried.',
   '60', 'xstockstrat-ingest', 'system:config-migration-feature-webhook-fanout-callback', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
