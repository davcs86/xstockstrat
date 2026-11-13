-- analysis 029 seed_fundamentals_blend_strategy (feature 335: AC-31, AC-32, AC-33, AC-34): run by
-- migration-rerun.py after pass 3. The owner is the identity seed user admin@localhost.

-- AC-31: admin present and owning no blend -> exactly one row, active, not live, system formula only.
BEGIN;
DELETE FROM analysis.strategies
 WHERE strategy_id = 'fundamentals_macd_blend'
   AND user_id = (SELECT user_id::text FROM identity.users WHERE email = 'admin@localhost');
\ir ../../services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.up.sql
DO $$
DECLARE
  admin_id TEXT := (SELECT user_id::text FROM identity.users WHERE email = 'admin@localhost');
  seeded analysis.strategies%ROWTYPE;
BEGIN
  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'AC-31: the harness database has no admin@localhost user';
  END IF;
  IF (SELECT count(*) FROM analysis.strategies
       WHERE user_id = admin_id AND strategy_id = 'fundamentals_macd_blend') <> 1 THEN
    RAISE EXCEPTION 'AC-31: expected exactly one seeded blend strategy for admin@localhost';
  END IF;
  SELECT * INTO seeded FROM analysis.strategies
   WHERE user_id = admin_id AND strategy_id = 'fundamentals_macd_blend';
  IF NOT seeded.active OR seeded.live_enabled THEN
    RAISE EXCEPTION 'AC-31: the seeded blend must be active and not live';
  END IF;
  IF seeded.definition_json ->> 'user_id' IS DISTINCT FROM admin_id THEN
    RAISE EXCEPTION 'AC-31: definition_json.user_id is not the owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(seeded.definition_json -> 'components') AS c
                  WHERE c ->> 'kind' = 'COMPONENT_KIND_CUSTOM_FORMULA')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(seeded.definition_json -> 'components') AS c
                 WHERE c ->> 'kind' = 'COMPONENT_KIND_CUSTOM_FORMULA'
                   AND c ->> 'formula_id' <> 'd1ff5e6b-6d9c-589d-b95e-defd862c702b') THEN
    RAISE EXCEPTION 'AC-31: the seeded blend must reference only the system formula';
  END IF;
END $$;
ROLLBACK;

-- AC-32: a blend the admin already owns is left untouched.
BEGIN;
UPDATE analysis.strategies SET live_enabled = TRUE, display_name = 'mine'
 WHERE strategy_id = 'fundamentals_macd_blend'
   AND user_id = (SELECT user_id::text FROM identity.users WHERE email = 'admin@localhost');
\ir ../../services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.up.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM analysis.strategies
                  WHERE strategy_id = 'fundamentals_macd_blend' AND live_enabled AND display_name = 'mine'
                    AND user_id = (SELECT user_id::text FROM identity.users WHERE email = 'admin@localhost')) THEN
    RAISE EXCEPTION 'AC-32: the seed changed a blend the admin already owned';
  END IF;
END $$;
ROLLBACK;

-- AC-33: with no admin@localhost user the seed succeeds and inserts nothing.
BEGIN;
DELETE FROM analysis.strategies WHERE strategy_id = 'fundamentals_macd_blend';
UPDATE identity.users SET email = 'renamed@localhost' WHERE email = 'admin@localhost';
\ir ../../services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.up.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM analysis.strategies WHERE strategy_id = 'fundamentals_macd_blend') THEN
    RAISE EXCEPTION 'AC-33: the seed inserted a blend although admin@localhost does not exist';
  END IF;
END $$;
ROLLBACK;

-- AC-34: the down leaves the strategy in place.
BEGIN;
\ir ../../services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.down.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM analysis.strategies
                  WHERE strategy_id = 'fundamentals_macd_blend'
                    AND user_id = (SELECT user_id::text FROM identity.users WHERE email = 'admin@localhost')) THEN
    RAISE EXCEPTION 'AC-34: the down removed the seeded blend strategy';
  END IF;
END $$;
ROLLBACK;
