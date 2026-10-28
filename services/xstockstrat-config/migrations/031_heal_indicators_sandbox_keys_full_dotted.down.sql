-- Migration: 031_heal_indicators_sandbox_keys_full_dotted.down.sql
-- Service: xstockstrat-config — feature 243
-- forward-only: an inverse cannot tell healed rows from pre-existing twins or S1 deletes; keeps premigration_031
SELECT 1;
