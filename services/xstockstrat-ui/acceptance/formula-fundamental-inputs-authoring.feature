# Promoted from docs/roadmap/features/205-formula-fundamental-inputs-authoring/acceptance.feature at
# integration (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-205` tag. Durable business rule: the /insights FormulaEditor lets an author declare
# fundamental inputs and test a fundamentals-scoring formula with symbol-prefilled, editable values.

Feature: xstockstrat-ui — /insights formula builder fundamental inputs
  The /insights FormulaEditor lets an author declare fundamental inputs and test a
  fundamentals-scoring formula with symbol-prefilled, editable values.

  @AC-2 @FR-1 @feature-205
  Scenario: The FormulaEditor declares fundamental inputs
    Given an author editing formula "pe_value_score" in the /insights FormulaEditor
    When the author selects PE_RATIO and PB_RATIO from the fundamental-input picker and saves
    Then the saved formula's fundamental_inputs contains PE_RATIO and PB_RATIO
    And the request sends the metrics as Connect-JSON NAME-strings

  @AC-6 @FR-5 @feature-205
  Scenario: The test harness prefills from a symbol and allows overrides
    Given the /insights formula test harness for "pe_value_score"
    And the author picks symbol "AAPL"
    When the harness loads AAPL's current fundamentals snapshot
    Then the pe_ratio and pb_ratio grid fields are prefilled from marketdata GetFundamentalsMulti
    And a metric absent from the snapshot (in missing_metrics) prefills as null, never NaN
    And the author can edit pe_ratio to 10.0 before running the test
