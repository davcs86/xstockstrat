-- Migration: 026_analysis_engine_blend_keys.down.sql
-- Service: xstockstrat-config
-- Reverse 026: remove exactly the two analysis.engine.fundamentals_blend_* keys seeded by 026.up
-- across all environments (global rows only, matching the seed's user_id NULL scope). Explicit
-- key IN (...) — never a LIKE 'engine.%' — so only what .up seeded is removed.

DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND key IN (
    'analysis.engine.fundamentals_blend_strategy_id',
    'analysis.engine.fundamentals_blend_enabled'
  );
