-- Migration: 021_notify_push_min_severity.up.sql
-- Service: xstockstrat-config
-- Seeds the notify.push.min_severity config key (feature 163, pwa-notifications) for staging + production.
--
-- The `key` column carries the FULL dotted key the notify service reads
-- (cfgWatcher.getInt("notify.push.min_severity")): the WatchConfig snapshot is keyed by the `key`
-- column with no namespace prefix added, so the seeded key must equal the read string. `namespace`
-- stays `notify` (the notify watcher subscribes to that namespace as a whole).
--
-- No VAPID credential row is seeded here — VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY / VAPID_SUBJECT are
-- delivered as DO App Platform `type: SECRET` / env vars (Slack/SendGrid precedent, feature 076/020),
-- never a config-service row (config @AC-2 / @AC-10; F-07).
--
-- Scope (post feature 147): every row is global (user_id NULL), seeded per environment. Uniqueness is
-- (namespace, key, environment, COALESCE(user_id, '')). value_type 'int' must match the reader getter
-- (ConfigWatcher.getInt) or the value silently returns the default (migration-016 value_type trap).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('notify', 'notify.push.min_severity', 'int', '2',
   'Web Push gate: minimum AlertSeverity ordinal to send a Web Push (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL). Clamped to [0,4] at read. Mirrors notify.fanout.min_severity; default 2 (WARNING) excludes INFO fill confirmations.',
   '2', 'xstockstrat-notify', 'staging', NULL),
  ('notify', 'notify.push.min_severity', 'int', '2',
   'Web Push gate: minimum AlertSeverity ordinal to send a Web Push (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL). Clamped to [0,4] at read. Mirrors notify.fanout.min_severity; default 2 (WARNING) excludes INFO fill confirmations.',
   '2', 'xstockstrat-notify', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
