# Promoted from docs/roadmap/features/293-fix-analysis-live-loop-budget-seed/acceptance.feature (C-16). Verbatim; do not hand-edit.
Feature: fix-analysis-live-loop-budget-seed (bug fix)
  Regression guard for defect report 2026-11-04-analysis-live-loop-chronic-budget-overflow-defect.

  @AC-2 @FR-5 @regression @feature-293
  Scenario: A steady-state budget overflow is logged once per state change, not on every cycle
    Given the live fleet has 690 live pairs and the budget is 200
    When the live loop runs 10 consecutive cycles
    Then exactly 1 overflow WARN is emitted in total
    And each of the 10 cycles still emits the INFO line "live_loop: evaluated 200/690 pairs"
    And the truncation counter increases by 490 on each of the 10 cycles
    When the pair count drifts to 700 for 5 more cycles
    Then the cumulative overflow WARN count is still 1
    When the budget changes to 250 and the next cycle runs (still 700 pairs)
    Then the cumulative overflow WARN count is 2
    When a cycle runs with 240 live pairs (under budget) and then one with 690 pairs again
    Then the cumulative overflow WARN count is 3
    When a cycle runs with 0 live pairs and then one with 690 pairs again
    Then the cumulative overflow WARN count is 4
