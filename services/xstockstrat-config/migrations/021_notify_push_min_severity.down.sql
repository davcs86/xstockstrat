-- Migration: 021_notify_push_min_severity.down.sql
-- Service: xstockstrat-config
-- Reverses 021_notify_push_min_severity.up.sql — removes the seeded notify.push.min_severity key.

DELETE FROM config.config_values
 WHERE namespace = 'notify'
   AND key = 'notify.push.min_severity';
