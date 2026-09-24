# Promoted from docs/roadmap/features/205-formula-fundamental-inputs-authoring/acceptance.feature at
# integration (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-205` tag. Durable business rule: the indicators formula store persists a formula's
# declared fundamental inputs so a fundamentals-scoring formula can be authored and read back.

Feature: xstockstrat-indicators — fundamental-input formula authoring
  The formula store persists a formula's declared fundamental inputs so a fundamentals-scoring
  formula can be authored and read back.

  @AC-1 @FR-1 @feature-205
  Scenario: Declare fundamental inputs on a formula via the agent
    Given an author calls manage_formula to create a formula "pe_value_score"
    And the call sets fundamental_inputs to ["FUNDAMENTAL_METRIC_PE_RATIO", "FUNDAMENTAL_METRIC_PB_RATIO"]
    When the formula is registered
    Then indicators persists fundamental_inputs = [PE_RATIO, PB_RATIO] on the formula
