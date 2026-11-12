-- Migration: 029_seed_fundamentals_blend_strategy.up.sql
-- Service: xstockstrat-analysis
-- feature 335: seeds the blend strategy for admin@localhost, active and not live. Reads identity.users
-- (the one migration-time cross-schema read; identity migrates first). Inserts nothing when that user is
-- missing. The strategy id is the seeded default of analysis.engine.fundamentals_blend_strategy_id.

INSERT INTO analysis.strategies (user_id, strategy_id, display_name, definition_json, active, live_enabled)
SELECT u.user_id::text, 'fundamentals_macd_blend', $t$Fundamentals-Signal MACD Blend$t$,
       $t${"strategy_id": "fundamentals_macd_blend", "display_name": "Fundamentals-Signal MACD Blend", "components": [{"ref_name": "macd", "kind": "COMPONENT_KIND_BUILTIN_INDICATOR", "indicator": "MACD", "params": {"slow": 26.0, "signal": 9.0, "fast": 12.0}}, {"ref_name": "fscore", "kind": "COMPONENT_KIND_CUSTOM_FORMULA", "formula_id": "d1ff5e6b-6d9c-589d-b95e-defd862c702b"}], "entry_rule": "{\"conditions\": [{\"fn\": \"crosses_above\", \"lhs\": \"macd\", \"rhs\": \"macd.signal\"}, {\"fn\": \">\", \"lhs\": \"fscore.composite\", \"rhs\": 0.5}], \"op\": \"AND\"}", "exit_rule": "{\"lhs\":\"macd\",\"fn\":\"crosses_below\",\"rhs\":\"macd.signal\"}", "signal_eligible": true}$t$::jsonb || jsonb_build_object('user_id', u.user_id::text),
       TRUE, FALSE
  FROM identity.users u
 WHERE u.email = 'admin@localhost'
ON CONFLICT (user_id, strategy_id) DO NOTHING;
