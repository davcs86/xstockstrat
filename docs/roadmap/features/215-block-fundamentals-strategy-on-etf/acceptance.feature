Feature: block-fundamentals-strategy-on-etf
  As a strategy author / the opportunity engine, I want a fundamentals-gated strategy to be refused or
  skipped with an explicit, auditable reason when applied to an ETF, so that I never mistake an
  un-evaluable asset for a genuine no-trade signal.

  @AC-1 @FR-1
  Scenario: The fundamental-operand detector classifies strategies correctly
    Given strategy "fundamentals_macd_blend" has a component that is the seeded fscore custom formula
    And strategy "squeeze_breakout_trend" has only MACD/SMA/volatility-stop indicator components
    When the guardrail predicate evaluates each strategy
    Then "fundamentals_macd_blend" is classified as requiring fundamentals
    And "squeeze_breakout_trend" is classified as not requiring fundamentals

  @AC-2 @FR-2
  Scenario: A fundamentals-gated backtest on an ETF returns an explicit reason, not a silent no-trade
    Given "fundamentals_macd_blend" requires fundamentals
    And "SCHD" is an ETF with no producible EDGAR fundamentals (its fundamentals_history is empty)
    When run_backtest is called for strategy "fundamentals_macd_blend" on symbol "SCHD"
    Then the SCHD diagnostics carry no_trade_reason "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE"
    And the result is not a silent total_trades=0 with no_trade_reason "NO_TRADE_REASON_ENTRY_NEVER_TRUE"

  @AC-3 @FR-5
  Scenario: Non-ETF equities and non-fundamentals strategies are unaffected
    Given "fundamentals_macd_blend" requires fundamentals and "AAPL" has EDGAR fundamentals
    And "squeeze_breakout_trend" does not require fundamentals
    When run_backtest is called for "fundamentals_macd_blend" on "AAPL"
    Then the AAPL result is evaluated normally with no "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE" reason
    When run_backtest is called for "squeeze_breakout_trend" on the ETF "SCHD"
    Then the SCHD result is evaluated normally on its price/indicator rules with no fundamentals-unavailable reason

  @AC-4 @FR-3
  Scenario: The opportunity engine excludes ETFs from a fundamentals-gated strategy's universe
    Given "fundamentals_macd_blend" requires fundamentals
    And the candidate universe for a compute pass includes the ETF "SCHD" and the equity "AAPL"
    When opportunities are computed for "fundamentals_macd_blend"
    Then no opportunity row is emitted for "SCHD"
    And "SCHD" is recorded as skipped with the reason "fundamentals unavailable (ETF)"

  @AC-5 @FR-6
  Scenario: The refusal is auditable
    Given a fundamentals-gated strategy is evaluated against the ETF "SCHD"
    When the guardrail skips "SCHD"
    Then a log line names the symbol "SCHD", the strategy id, and "fundamentals unavailable"
    And the enumerated reason is present on the returned result rather than only in logs

  @AC-6 @FR-4
  Scenario: A live-enabled fundamentals-gated strategy does not silently evaluate an ETF
    Given "fundamentals_macd_blend" is live_enabled and requires fundamentals
    When the live evaluation path assesses the ETF "SCHD"
    Then "SCHD" yields the guardrail reason "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE" rather than a silent no-signal
