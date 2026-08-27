-- Migration: 020_remove_analysis_signal_source_weights.up.sql
-- Service: xstockstrat-config
-- Feature 161: delete the dead analysis.signals.source_weights config key. It was superseded by
-- feature 134 (the per-source weight now lives on ingest.SignalSource.reliability_weight) and is
-- read by no service; migration 016 only reworded its description. This removes both environment
-- rows. The config service's now-orphaned FLOAT_MAP validation machinery is removed in the same
-- feature (configServiceImpl.ts).
DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND key = 'signals.source_weights';
