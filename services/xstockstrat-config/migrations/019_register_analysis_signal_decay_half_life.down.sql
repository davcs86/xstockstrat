-- Migration: 019_register_analysis_signal_decay_half_life.down.sql
-- Service: xstockstrat-config
-- Feature 161: remove the two global rows that 019 up inserted. Scoped to user_id IS NULL so a
-- per-user override (if an operator created one) is never clobbered by this rollback.
DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND key = 'scoring.signal_decay_half_life_hours'
  AND user_id IS NULL
  AND environment IN ('staging', 'production');
