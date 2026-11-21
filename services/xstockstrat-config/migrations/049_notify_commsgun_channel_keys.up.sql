-- Migration: 049_notify_commsgun_channel_keys.up.sql
-- Service: xstockstrat-config, feature notify-commsgun-channel. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('notify', 'fanout.email_provider', 'string', 'auto',
   'Email provider for alert fanout: auto, commsgun or sendgrid; any other value reads as auto. auto sends through commsgun when its URL, app id, recipient and app key are all set, otherwise through SendGrid. commsgun never uses SendGrid; sendgrid never calls commsgun and reroutes queued emails to SendGrid.',
   'auto', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'fanout.email_provider', 'string', 'auto',
   'Email provider for alert fanout: auto, commsgun or sendgrid; any other value reads as auto. auto sends through commsgun when its URL, app id, recipient and app key are all set, otherwise through SendGrid. commsgun never uses SendGrid; sendgrid never calls commsgun and reroutes queued emails to SendGrid.',
   'auto', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL),
  ('notify', 'commsgun.enqueue_url', 'string', '',
   'Full HTTPS URL of the commsgun enqueue endpoint. Empty means commsgun is not configured. Clearing it while emails are queued in auto mode sends them through SendGrid instead.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'commsgun.enqueue_url', 'string', '',
   'Full HTTPS URL of the commsgun enqueue endpoint. Empty means commsgun is not configured. Clearing it while emails are queued in auto mode sends them through SendGrid instead.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL),
  ('notify', 'commsgun.app_id', 'string', 'xstockstrat-staging',
   'Commsgun subscriber app this environment sends as (the X-Commsgun-App header). Each environment has its own app and app key. Change it only while no email is queued.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'commsgun.app_id', 'string', 'xstockstrat',
   'Commsgun subscriber app this environment sends as (the X-Commsgun-App header). Each environment has its own app and app key. Change it only while no email is queued.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL),
  ('notify', 'commsgun.to_email', 'string', '',
   'Recipient address of alert email sent through commsgun. Empty means commsgun is not configured. Emails already queued keep the address they were queued with.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'commsgun.to_email', 'string', '',
   'Recipient address of alert email sent through commsgun. Empty means commsgun is not configured. Emails already queued keep the address they were queued with.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL),
  ('notify', 'commsgun.max_attempts', 'int', '8',
   'Attempts a queued email gets at commsgun before it ends undelivered and an alert is raised. Raising it keeps retrying an unreachable hub for longer.',
   '8', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'commsgun.max_attempts', 'int', '8',
   'Attempts a queued email gets at commsgun before it ends undelivered and an alert is raised. Raising it keeps retrying an unreachable hub for longer.',
   '8', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL),
  ('notify', 'commsgun.backoff_base_seconds', 'int', '30',
   'Seconds before the first commsgun retry; each later retry doubles the wait, up to commsgun.backoff_max_seconds. Raising it slows every retry.',
   '30', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'commsgun.backoff_base_seconds', 'int', '30',
   'Seconds before the first commsgun retry; each later retry doubles the wait, up to commsgun.backoff_max_seconds. Raising it slows every retry.',
   '30', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL),
  ('notify', 'commsgun.backoff_max_seconds', 'int', '3600',
   'Longest wait in seconds between two commsgun attempts; it also caps a Retry-After answer. Lowering it retries a failing hub more often.',
   '3600', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'commsgun.backoff_max_seconds', 'int', '3600',
   'Longest wait in seconds between two commsgun attempts; it also caps a Retry-After answer. Lowering it retries a failing hub more often.',
   '3600', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL),
  ('notify', 'commsgun.request_timeout_seconds', 'int', '10',
   'Seconds one commsgun request may take before it counts as a timeout and is retried. Clamped to 1-60.',
   '10', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'commsgun.request_timeout_seconds', 'int', '10',
   'Seconds one commsgun request may take before it counts as a timeout and is retried. Clamped to 1-60.',
   '10', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;

-- Ciphertext stays NULL: a migration has no master key. GetSecret answers found=false until the key is set.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('notify', 'commsgun.app_key', 'string', '[redacted]', TRUE,
   'Commsgun app key of this environment''s subscriber app (encrypted secret; set per environment after deploy). Unset means commsgun is not ready.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'staging', NULL),
  ('notify', 'commsgun.app_key', 'string', '[redacted]', TRUE,
   'Commsgun app key of this environment''s subscriber app (encrypted secret; set per environment after deploy). Unset means commsgun is not ready.',
   '', 'xstockstrat-notify', 'system:config-migration-feature-notify-commsgun-channel', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
