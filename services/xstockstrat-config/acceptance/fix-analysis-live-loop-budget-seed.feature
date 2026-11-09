# Promoted from docs/roadmap/features/293-fix-analysis-live-loop-budget-seed/acceptance.feature (C-16). Verbatim; do not hand-edit.
Feature: fix-analysis-live-loop-budget-seed (bug fix)
  Regression guard for defect report 2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.

  # ─── feature 296: stored keys are namespace-relative ───
  # Feature 296 (operator-signed C-16 CHANGE, davcs86 2026-11-07, 296 context.md) renames every stored key to the
  # namespace-relative form. The scenarios below are left unedited; read each listed one as follows:
  #  - 293 @AC-1, @AC-3, @AC-5, @AC-7, @AC-10, @AC-12, @AC-13: seed/stored-key Thens read 'relative, since migration R (feature 296)'; SetConfig request keys are relative (feature 296 @AC-1).

  @AC-1 @FR-1 @regression @feature-293
  Scenario: The live-loop budget key is registered in a freshly migrated environment
    Given a freshly migrated config registry for "staging" and for "production"
    When the analysis namespace keys are listed
    Then analysis.engine.max_strategies_per_cycle is present in each environment as an int with value 50
    And its default_value is 50, its description is non-empty and its consuming_service is "xstockstrat-analysis"

  @AC-3 @FR-2 @regression @feature-293
  Scenario: The seed preserves a runtime-created value and backfills its metadata
    Given staging holds analysis.engine.max_strategies_per_cycle = 200 as an int created by SetConfig with create_key=true
    And that row has an empty description and an empty default_value
    When the seed migration is applied
    Then GetConfig for the key on staging returns 200
    And the key's description is non-empty and its default_value is 50
    And listing the analysis keys shows exactly one row for the key on staging
    And its value_type is still int

  @AC-4 @FR-2 @feature-293
  Scenario: Applying the seed migration twice leaves one row per environment
    Given the seed migration has been applied once
    When it is applied a second time
    Then there is exactly one row for the key in "staging" and exactly one in "production"
    And staging still holds 200 and production still holds 50

  @AC-5 @FR-3 @regression @feature-293
  Scenario: SetConfig works for the registered key without create_key
    Given the key is registered
    When an admin calls SetConfig for analysis.engine.max_strategies_per_cycle with value 150 and create_key=false
    Then the call succeeds and GetConfig returns 150

  @AC-6 @FR-3 @feature-293
  Scenario: SetConfig bounds reject out-of-range values
    Given the key is registered with bounds [1, 1000]
    When an admin calls SetConfig with value 0, and again with value -5
    Then both calls are refused with INVALID_ARGUMENT
    And SetConfig with value 1001 is refused with INVALID_ARGUMENT (maximum 1000)
    And SetConfig with value 1, with value 200 and with value 1000 is accepted

  @AC-7 @FR-6 @feature-293
  Scenario: Rolling back the seed keeps an operator-set value
    Given staging holds the key at 200 and production holds the seeded 50
    And a per-user override of 75 exists for user "user-2" on staging
    And a per-user override of 50 (equal to the seeded value) exists for user "user-3" on staging
    And an unrelated key in another namespace holds the value 50 on staging
    When the down migration is applied
    Then the production row is removed
    And the staging global row with value 200 and both per-user overrides remain
    And the unrelated key is unchanged

  @AC-8 @FR-4 @feature-293
  Scenario: The wiring check passes with the baseline entry removed
    Given the seed migration is declared
    When node scripts/check-config-wiring.mjs --declared-migration <the new migration file> is run
    Then it exits 0 and scripts/config-wiring.json contains no entry for analysis.engine.max_strategies_per_cycle or analysis.engine.eval_interval_seconds

  @AC-9 @FR-2 @regression @feature-293
  Scenario: The seed never overwrites operator-written metadata
    Given staging holds analysis.engine.max_strategies_per_cycle = 200 with description "Operator note" and default_value "75"
    When the seed migration is applied
    Then GetConfig for the key on staging returns 200
    And its description is still "Operator note" and its default_value is still 75

  @AC-10 @FR-1 @FR-2 @regression @feature-293
  Scenario: The eval-interval key is registered in a freshly migrated environment
    Given a freshly migrated config registry for "staging" and for "production"
    When the analysis namespace keys are listed
    Then analysis.engine.eval_interval_seconds is present in each environment as an int with value 60
    And its default_value is 60, its description is non-empty and its consuming_service is "xstockstrat-analysis"

  @AC-11 @FR-3 @regression @feature-293
  Scenario: SetConfig bounds for the eval interval
    Given the key analysis.engine.eval_interval_seconds is registered with bounds [30, 600]
    When an admin calls SetConfig with value 0, -5, 29 and 601
    Then every call is refused with INVALID_ARGUMENT and nothing is written
    And SetConfig with value 30, with value 60 and with value 600 is accepted without create_key

  @AC-12 @FR-6 @feature-293
  Scenario: Rolling back the seed keeps an operator-set eval interval
    Given staging holds analysis.engine.eval_interval_seconds at 90 and production holds the seeded 60
    And a per-user override of 60 (equal to the seeded value) exists for user "user-2" on staging
    When the down migration is applied
    Then the production row is removed
    And the staging global row with value 90 and the per-user override remain

  @AC-13 @FR-6 @feature-293
  Scenario: Rolling back the seed keeps rows another migration seeded at the same values
    Given production holds analysis.engine.max_strategies_per_cycle at 50 and analysis.engine.eval_interval_seconds at 60
    And both rows were written by config migration 041, not by this seed
    When the seed and then the down migration are applied
    Then both production rows remain with their value, description and writer unchanged
