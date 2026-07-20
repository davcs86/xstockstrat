-- Migration: 008_analysis_fundsignal_keys.down.sql
-- Service: xstockstrat-config
-- Removes the seeded analysis.fundsignal.* keys.
DELETE FROM config.config_values
 WHERE namespace = 'analysis' AND key LIKE 'fundsignal.%';
