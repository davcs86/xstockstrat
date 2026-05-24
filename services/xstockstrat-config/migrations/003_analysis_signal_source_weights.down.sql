-- Migration: 003_analysis_signal_source_weights.down.sql
-- Removes analysis.signals.source_weights config key

DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND key = 'signals.source_weights';
