# Promoted from docs/roadmap/features/215-block-fundamentals-strategy-on-etf/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-215` tag.
# Durable business rules xstockstrat-analysis already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: @AC-1/@AC-10 tests/test_fundamentals_guard.py; @AC-2/3/5/8/10/12 tests/test_backtest_fundamentals_guard.py;
# @AC-6/@AC-9 tests/test_live_loop.py (feature 215 class); @AC-8/9/13 tests/test_opportunities_fundamentals_guard.py;
# @AC-11/@AC-12 tests/test_grade_fundamentals_exclusion.py; @AC-12 tests/test_fundamentals_pit_pager.py.
# @AC-4 is NOT promoted (its plain-label Then is asserted only at the data level — see the feature's Deviation Log).

Feature: xstockstrat-analysis — block fundamentals-gated strategies on symbols without fundamentals (ETFs)
  A strategy that requires fundamentals is refused, denied entry, or skipped with an explicit,
  auditable reason on a symbol with no usable fundamentals (an ETF such as SCHD), never a silent
  no-trade that reads like a genuine no-signal.

  @AC-1 @FR-1 @feature-215
  Scenario: The fundamental-operand detector classifies strategies correctly
    Given strategy "fundamentals_macd_blend" has a component that is the seeded fscore custom formula
    And strategy "squeeze_breakout_trend" has only MACD/SMA/volatility-stop indicator components
    When the guardrail predicate evaluates each strategy
    Then "fundamentals_macd_blend" is classified as requiring fundamentals
    And "squeeze_breakout_trend" is classified as not requiring fundamentals

  @AC-2 @FR-2 @feature-215
  Scenario: A fundamentals-gated backtest on an ETF returns an explicit reason, not a silent no-trade
    Given "fundamentals_macd_blend" requires fundamentals
    And "SCHD" is an ETF with no producible EDGAR fundamentals (its fundamentals_history is empty)
    When run_backtest is called for strategy "fundamentals_macd_blend" on symbol "SCHD"
    Then the SCHD diagnostics carry no_trade_reason "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE"
    And the result is not a silent total_trades=0 with no_trade_reason "NO_TRADE_REASON_ENTRY_NEVER_TRUE"

  @AC-3 @FR-5 @feature-215
  Scenario: Non-ETF equities and non-fundamentals strategies are unaffected
    Given "fundamentals_macd_blend" requires fundamentals and "AAPL" has EDGAR fundamentals
    And "squeeze_breakout_trend" does not require fundamentals
    When run_backtest is called for "fundamentals_macd_blend" on "AAPL"
    Then the AAPL result is evaluated normally with no "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE" reason
    When run_backtest is called for "squeeze_breakout_trend" on the ETF "SCHD"
    Then the SCHD result is evaluated normally on its price/indicator rules with no fundamentals-unavailable reason

  @AC-5 @FR-6 @feature-215
  Scenario: The refusal is auditable
    Given a fundamentals-gated strategy is evaluated against the ETF "SCHD"
    When the guardrail skips "SCHD"
    Then a log line names the symbol "SCHD", the strategy id, and "fundamentals unavailable"
    And the enumerated reason is present on the returned result rather than only in logs

  @AC-6 @FR-4 @feature-215
  Scenario: A live-enabled fundamentals-gated strategy is denied entry on an ETF, auditably
    Given "fundamentals_macd_blend" is live_enabled and requires fundamentals
    When the live evaluation path assesses the ETF "SCHD" over three cycles
    Then "SCHD" is denied entry and a WARN log names "SCHD", the strategy id, and "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE"
    And exactly one WARNING alert is emitted while "SCHD" stays unavailable
    And an exit for a held "SCHD" position still fires

  @AC-8 @FR-8 @feature-215
  Scenario: A fundamentals outage is not reported as absence
    Given GetHistoricalFundamentals and GetFundamentals return Unavailable
    When run_backtest is called for "fundamentals_macd_blend" on "SCHD"
    Then no "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE" reason is set, a "fundamentals fetch failed — rerun" warning is present, and no evidence cell is written
    When opportunities are computed for two fundamentals strategies and one technical strategy on "SCHD"
    Then both fundamentals rows are data-unavailable with their actions preserved
    And the technical strategy's row is evaluated normally

  @AC-9 @FR-8 @feature-215
  Scenario: A globally disabled snapshot source is not reported as absence
    Given the marketdata fundamentals snapshot source is globally disabled (FailedPrecondition)
    When opportunities are computed and the live loop runs for "fundamentals_macd_blend"
    Then opportunity rows are evaluated without the data-unavailable or fundamentals-unavailable marker and are not retried
    And the live loop makes no state change and emits no alert

  @AC-10 @FR-8 @feature-215
  Scenario: Partial rows evaluate and filings at or after the window's last bar do not count
    Given a formula declaring {BETA, PE_RATIO} and a "SCHD" snapshot row carrying only beta
    Then that formula is evaluated on "SCHD", not refused
    Given a symbol whose first filing is dated on or after the backtest window's last bar
    When the backtest runs for a fundamentals-requiring strategy on that window
    Then the symbol is refused with "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE"

  @AC-11 @FR-9 @feature-215
  Scenario: The derived grade excludes refused symbols without deleting evidence
    Given "fundamentals_macd_blend" has pre-existing evidence cells under its current fingerprint for "AAPL" and a 0-trade "SCHD" cell, including one with a NULL range_end
    When the grade is recomputed
    Then the derived grade counts "AAPL" and not "SCHD"
    And every "SCHD" cell still exists in analysis.backtest_run_symbols
    When run_backtest refuses "SCHD" alone with status INSUFFICIENT_DATA
    Then the headline grade is recomputed
    When GetHistoricalFundamentals is unavailable during a recompute
    Then the previous headline grade is kept and a warning is logged

  @AC-12 @FR-10 @feature-215
  Scenario: Point-in-time fundamentals are read across all pages
    Given "AAPL" has more than 50 stored fundamentals periods with dividend_yield present only in the newest periods
    When a backtest, the live loop, and a grade recompute load AAPL's PIT fundamentals
    Then every stored period is loaded and "AAPL" is not refused
    Given marketdata keeps returning a next_page_token past the page cap
    Then the symbol is treated as unknown (fetch-failed warning), never refused

  @AC-13 @FR-3 @FR-8 @feature-215
  Scenario: A bars outage on a fundamentals strategy stays a data-unavailable row and heals correctly
    Given "fundamentals_macd_blend" and the ETF "SCHD" as an entry candidate
    And BatchGetBars fails for "SCHD" during the compute
    Then the "SCHD" row is data-unavailable with its resolved action preserved and is not flagged fundamentals-unavailable
    When the 300s self-heal runs after bars recover
    Then the row is rewritten to the non-actionable fundamentals-unavailable row with action UNSPECIFIED and no data-unavailable marker
