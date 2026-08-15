-- Migration: 016_deprecate_analysis_signal_source_weights_desc.up.sql
-- Service: xstockstrat-config
-- Feature 134: reword the analysis.signals.source_weights key description to mark it superseded.
-- The key is retained (deletion is out of scope) but is no longer read by any service — the
-- per-source weight now lives on ingest.SignalSource.reliability_weight (validated reject-at-write
-- in [0,1]) and is applied by analysis via ListSignalSources. Description-only change: value_type /
-- value_data / bounds are untouched (never change a key's value_type in place).

UPDATE config.config_values
SET description = 'SUPERSEDED (feature 134): the per-source reliability weight now lives on '
                 || 'ingest.SignalSource.reliability_weight (validated reject-at-write in [0.0, 1.0]) '
                 || 'and is read by analysis via ListSignalSources. This key is retained for history '
                 || 'but is no longer read by any service — editing it has no effect.'
WHERE namespace = 'analysis' AND key = 'signals.source_weights';
