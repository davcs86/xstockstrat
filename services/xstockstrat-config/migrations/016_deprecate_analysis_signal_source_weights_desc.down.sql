-- Migration: 016_deprecate_analysis_signal_source_weights_desc.down.sql
-- Restores the original (feature 007 / migration 003) description verbatim.

UPDATE config.config_values
SET description = 'JSON object mapping signal source name to reliability weight in [0.0, 1.0]. '
                 || 'Empty object means all sources use weight 1.0 (neutral).'
WHERE namespace = 'analysis' AND key = 'signals.source_weights';
