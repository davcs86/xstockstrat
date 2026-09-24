Feature: formula-fundamental-inputs-authoring
  As a formula author, I want to declare, see, discover, and test a formula's fundamental inputs
  from both the MCP agent tools and the /insights formula builder, so that I can build and
  validate a fundamentals-scoring formula directly.

  @AC-1 @FR-1
  Scenario: Declare fundamental inputs on a formula via the agent
    Given an author calls manage_formula to create a formula "pe_value_score"
    And the call sets fundamental_inputs to ["FUNDAMENTAL_METRIC_PE_RATIO", "FUNDAMENTAL_METRIC_PB_RATIO"]
    When the formula is registered
    Then indicators persists fundamental_inputs = [PE_RATIO, PB_RATIO] on the formula

  @AC-2 @FR-1
  Scenario: The FormulaEditor declares fundamental inputs
    Given an author editing formula "pe_value_score" in the /insights FormulaEditor
    When the author selects PE_RATIO and PB_RATIO from the fundamental-input picker and saves
    Then the saved formula's fundamental_inputs contains PE_RATIO and PB_RATIO
    And the request sends the metrics as Connect-JSON NAME-strings

  @AC-3 @FR-2
  Scenario: Declared fundamental inputs round-trip on read
    Given formula "pe_value_score" has fundamental_inputs [PE_RATIO, PB_RATIO]
    When an author calls get_formula for "pe_value_score"
    Then the response lists fundamental_inputs = ["FUNDAMENTAL_METRIC_PE_RATIO", "FUNDAMENTAL_METRIC_PB_RATIO"]
    And the FormulaEditor shows both metrics as selected

  @AC-4 @FR-3
  Scenario: The fundamental-metric catalog is discoverable
    Given an author who has not read the proto
    When the author requests the available fundamental metrics via the MCP
    Then the response includes all 11 FundamentalMetric values with a human-readable meaning for each
    And the /insights fundamental-input picker offers the same 11 options

  @AC-5 @FR-4
  Scenario: Test a fundamentals-scoring formula with supplied values
    Given formula "pe_value_score" declares fundamental_inputs [PE_RATIO, PB_RATIO]
    When an author calls test_formula supplying input_data {PE_RATIO: 12.5, PB_RATIO: 1.8}
    Then the response returns the formula's output score computed from those values
    And no OHLCV closes are required for the run

  @AC-6 @FR-5
  Scenario: The test harness prefills from a symbol and allows overrides
    Given the /insights formula test harness for "pe_value_score"
    And the author picks symbol "AAPL"
    When the harness loads AAPL's current fundamentals snapshot
    Then the PE_RATIO and PB_RATIO fields are prefilled from marketdata GetFundamentalsMulti
    And the author can edit PE_RATIO to 10.0 before running the test

  @AC-7 @FR-6
  Scenario: An authored fundamentals formula behaves identically as a strategy component
    Given formula "pe_value_score" authored via the FormulaEditor with fundamental_inputs [PE_RATIO, PB_RATIO]
    When the same formula is used as a COMPONENT_KIND_CUSTOM_FORMULA in a strategy (feature 201)
    Then the strategy evaluator feeds it the same PE_RATIO and PB_RATIO inputs
    And the component output matches the score test_formula returned for equal inputs
