Feature: fix-analysis-live-loop-budget-seed (bug fix)
  Regression guard for defect report 2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.

  @AC-1 @regression
  Scenario: The live-loop budget key is registered in every environment
    Given a freshly migrated config registry
    When the analysis namespace keys are listed
    Then analysis.engine.max_strategies_per_cycle is present with a description and its code default
    And an existing runtime-created value is not overwritten by the seed

  @AC-2 @regression
  Scenario: A steady-state budget overflow is not logged as a WARN on every cycle
    Given the live fleet exceeds max_strategies_per_cycle for many consecutive cycles
    When the live loop runs each cycle
    Then the overflow is reported once per state change or per full rotation rather than every cycle
