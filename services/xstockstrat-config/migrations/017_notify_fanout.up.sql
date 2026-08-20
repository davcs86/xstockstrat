-- Migration: 017_notify_fanout.up.sql
-- Service: xstockstrat-config
-- Seeds the notify.fanout.* config keys (feature 020, notify-external-fanout) for dev + production.
--
-- The `key` column carries the FULL dotted key the notify service reads (e.g.
-- cfgWatcher.getInt("notify.fanout.min_severity")): the WatchConfig snapshot is keyed by the `key`
-- column with no namespace prefix added, so the seeded key must equal the read string. `namespace`
-- stays `notify` for every row (the notify watcher subscribes to that namespace as a whole).
--
-- No credential row is seeded here — SLACK_WEBHOOK_URL / SENDGRID_API_KEY are delivered as DO App
-- Platform `type: SECRET` env vars (feature 076 precedent), never a config-service row.
--
-- value_type must match the reader getter (getInt/getFloat/getString) or the value silently returns
-- the default (migration-016 value_type-immutability trap). The two sendgrid_*_email keys seed empty
-- strings — email fanout is disabled until both are populated AND SENDGRID_API_KEY is set.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode, is_secret)
VALUES
  ('notify', 'notify.fanout.min_severity', 'int', '2',
   'Primary fanout gate: minimum AlertSeverity ordinal to fan out (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL). Clamped to [0,4] at read. Default 2 (WARNING) excludes INFO fill confirmations -- lower to 1 to fan out fills.',
   '2', 'xstockstrat-notify', 'dev', 'all', FALSE),
  ('notify', 'notify.fanout.min_severity', 'int', '2',
   'Primary fanout gate: minimum AlertSeverity ordinal to fan out (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL). Clamped to [0,4] at read. Default 2 (WARNING) excludes INFO fill confirmations -- lower to 1 to fan out fills.',
   '2', 'xstockstrat-notify', 'production', 'all', FALSE),

  ('notify', 'notify.fanout.min_confidence_threshold', 'float', '0.7',
   'Minimum analysis readiness ordinal (fraction of passing entry-condition leaves -- NOT a probability); applied only when the alert context.conviction is present. Conviction-less alerts are gated by min_severity alone.',
   '0.7', 'xstockstrat-notify', 'dev', 'all', FALSE),
  ('notify', 'notify.fanout.min_confidence_threshold', 'float', '0.7',
   'Minimum analysis readiness ordinal (fraction of passing entry-condition leaves -- NOT a probability); applied only when the alert context.conviction is present. Conviction-less alerts are gated by min_severity alone.',
   '0.7', 'xstockstrat-notify', 'production', 'all', FALSE),

  ('notify', 'notify.fanout.dedup_window_seconds', 'int', '300',
   'Suppress re-delivery of a byte-identical alert within this many seconds.',
   '300', 'xstockstrat-notify', 'dev', 'all', FALSE),
  ('notify', 'notify.fanout.dedup_window_seconds', 'int', '300',
   'Suppress re-delivery of a byte-identical alert within this many seconds.',
   '300', 'xstockstrat-notify', 'production', 'all', FALSE),

  ('notify', 'notify.fanout.sendgrid_from_email', 'string', '',
   'Sender address for outbound fanout email. Empty until configured; email fanout stays disabled until both from/to are set AND SENDGRID_API_KEY is present.',
   '', 'xstockstrat-notify', 'dev', 'all', FALSE),
  ('notify', 'notify.fanout.sendgrid_from_email', 'string', '',
   'Sender address for outbound fanout email. Empty until configured; email fanout stays disabled until both from/to are set AND SENDGRID_API_KEY is present.',
   '', 'xstockstrat-notify', 'production', 'all', FALSE),

  ('notify', 'notify.fanout.sendgrid_to_email', 'string', '',
   'Recipient address for outbound fanout email. Empty until configured; email fanout stays disabled until both from/to are set AND SENDGRID_API_KEY is present.',
   '', 'xstockstrat-notify', 'dev', 'all', FALSE),
  ('notify', 'notify.fanout.sendgrid_to_email', 'string', '',
   'Recipient address for outbound fanout email. Empty until configured; email fanout stays disabled until both from/to are set AND SENDGRID_API_KEY is present.',
   '', 'xstockstrat-notify', 'production', 'all', FALSE)
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
