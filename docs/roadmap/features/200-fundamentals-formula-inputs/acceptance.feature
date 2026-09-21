Feature: fundamentals-formula-inputs
  As a strategist, I want a custom formula that consumes fundamentals as inputs and returns a score
  (the same input/output as the fundamentals signal producer's scoring formula) to be usable as a
  component in a strategy, so that my fundamentals scoring can drive entry/exit rules directly.

  @AC-1 @FR-1 @FR-4
  Scenario: A fundamentals-scoring formula component resolves to a score series a rule can gate on
    Given a strategy with a custom-formula component "fscore" (formula id "value_quality") and an entry rule {"fn": ">", "lhs": "fscore.composite", "rhs": 0.6}
    And the "value_quality" formula reads fundamentals input_data and returns value, quality, and composite scalar outputs
    When the strategy is evaluated over AAPL bars where AAPL's fundamentals yield composite 0.72
    Then the "fscore.composite" component series carries 0.72 broadcast across those bars and the entry rule fires
    # bare "fscore" resolves to the primary "value" sub-score per the value-primary convention; the headline score is the dotted "fscore.composite" (what the producer reads). All three scalar outputs are broadcast and addressable.

  @AC-2 @FR-2
  Scenario: In a backtest the formula sees point-in-time fundamentals, no look-ahead
    Given a fundamentals-scoring formula component and an AAPL PIT filing with eps 3.0 filed 2020-01-29
    And an earlier AAPL PIT filing with eps 1.0 filed 2019-10-30
    When the strategy is backtested over bars 2020-01-27 through 2020-01-31
    Then the formula is fed eps 1.0 on bars dated on or before 2020-01-29
    And the formula is fed eps 3.0 only on bars dated 2020-01-30 or later

  @AC-3 @FR-3
  Scenario: In live/screener the formula sees the current fundamentals snapshot
    Given the same fundamentals-scoring formula component evaluated on the live path for AAPL
    When the live loop evaluates the latest bar
    Then the formula is fed AAPL's current-snapshot fundamentals from GetFundamentalsMulti
    And no GetHistoricalFundamentals PIT lookup is performed on the live path

  @AC-4 @FR-5
  Scenario: One formula, identical I/O in the producer and in a strategy
    Given the formula id "value_quality" registered once
    When the fundamentals signal producer scores AAPL with it and a strategy component evaluates it for AAPL on the same as-of fundamentals
    Then both invocations pass the same fundamentals input_data keys and read the same composite output field

  @AC-5 @FR-6
  Scenario: Missing fundamentals or a formula error degrades to hold, never fabricates
    Given a fundamentals-scoring formula component over {AAPL, INTC}
    And INTC has no fundamentals available for the evaluated span and the formula raises for INTC
    When the strategy is evaluated
    Then INTC's "fscore" component series is None (hold) for that span and no 0.0 score is fabricated
    And AAPL is scored normally and the evaluation does not abort

  @AC-6 @FR-7
  Scenario: A formula's declared fundamentals inputs are validated at formula-registration write time
    Given a RegisterFormula (or UpdateFormula) whose fundamental_inputs contains FUNDAMENTAL_METRIC_UNSPECIFIED (the zero-value sentinel)
    When the formula is written
    Then indicators rejects the write INVALID_ARGUMENT naming the unspecified fundamentals metric
    And a formula declaring only valid FundamentalMetric enum values (e.g. PE_RATIO, ROE) is accepted and can then be bound into a strategy component
    # Validation lives at indicators RegisterFormula/UpdateFormula because fundamental_inputs is a closed FundamentalMetric enum on FormulaDefinition (R3: relocated here from the ManageStrategy path; a closed enum makes a non-member structurally unrepresentable, so the only invalid value is the zero-value sentinel).

  @AC-7 @FR-1
  Scenario: A technical (non-fundamentals) formula component is byte-for-byte unaffected
    Given a strategy with an ordinary technical custom-formula component over OHLCV closes
    When the strategy is evaluated in a backtest
    Then the component receives only bar closes as before and no fundamentals input_data is added
