-- Migration: 018_notify_fanout.down.sql
-- Service: xstockstrat-config
-- Reverses 018_notify_fanout.up.sql — removes the seeded notify.fanout.* keys.

DELETE FROM config.config_values
 WHERE namespace = 'notify'
   AND key IN (
     'notify.fanout.min_severity',
     'notify.fanout.min_confidence_threshold',
     'notify.fanout.dedup_window_seconds',
     'notify.fanout.sendgrid_from_email',
     'notify.fanout.sendgrid_to_email'
   );
