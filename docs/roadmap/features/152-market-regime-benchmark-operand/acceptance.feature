Feature: market-regime-benchmark-operand
  As a strategy author, I want a component computed on a fixed reference symbol instead of the
  evaluated symbol, so that I can gate entries/exits on broad-market regime across any symbol.

  @AC-1 @FR-1
  Scenario: Empty source_symbol reproduces existing behavior byte-for-byte
    Given the pre-existing strategy "squeeze_breakout_trend" whose components all have empty source_symbol
    And a fixed backtest window start "2024-01-01" end "2024-12-31"
    When the strategy is backtested twice over that window
    Then both runs return identical metrics (total_return, sharpe, max_drawdown)
    And those metrics equal the strategy's current committed baseline for that window

  @AC-2 @FR-1 @FR-3
  Scenario: A component with source_symbol is computed on the benchmark's bars
    Given a component "mkt" = SMA-slope(period 200, lookback 20) with source_symbol "VOO"
    And an evaluated symbol "AAPL"
    When the strategy is backtested
    Then "mkt" at each evaluated-symbol bar equals the SMA-slope computed on VOO's own bar series at that timestamp
    And the value at bar t uses only VOO data with timestamp <= t

  @AC-3 @FR-2
  Scenario: A missing benchmark bar becomes a gap that evaluates hold/false, never forward-filled
    Given an evaluated symbol "AAPL" that traded on "2024-07-05"
    And the benchmark "VOO" has no bar on "2024-07-05"
    And an entry rule references the benchmark component "mkt" on that bar
    When the strategy is backtested
    Then the entry condition on "2024-07-05" evaluates to false (hold)
    And AAPL's own "2024-07-05" bar is still present in the result (the symbol is not reindexed to VOO)
    And "mkt" on "2024-07-05" is not filled from the prior benchmark bar

  @AC-4 @FR-4
  Scenario: Insufficient benchmark history names the benchmark in coverage_gaps
    Given a component "mkt" = SMA(period 200) with source_symbol "VOO"
    And VOO has only 120 bars of history before the backtest start
    When the strategy is backtested
    Then the run status is BACKTEST_STATUS_INSUFFICIENT_DATA
    And coverage_gaps names symbol "VOO" as the symbol lacking data

  @AC-5 @FR-3
  Scenario: Benchmark bars are warmed from before start for a reproducible window
    Given a component "mkt" = SMA(period 200) with source_symbol "VOO"
    And a backtest window start "2025-01-02" end "2025-06-30"
    When the strategy is backtested on two different calendar days
    Then both runs return identical metrics
    And "mkt" is defined (non-gap) on the first in-window evaluated bar because VOO was warmed from before "2025-01-02"

  @AC-6 @FR-5
  Scenario: manage_strategy normalizes source_symbol and folds it into the fingerprint
    Given a strategy saved with a component whose source_symbol is "voo" (lowercase, with surrounding spaces)
    When the strategy is persisted via manage_strategy
    Then the stored component source_symbol is "VOO" (trimmed, uppercased)
    And changing a component's source_symbol from "VOO" to "SPY" produces a different definition fingerprint
    And an empty-after-trim source_symbol is stored as unset (evaluated-symbol behavior)

  @AC-7 @FR-6
  Scenario: Live evaluation resolves the benchmark component on a benchmark-referencing strategy
    Given a live-enabled strategy with a component "mkt" = SMA-slope(200,20) on source_symbol "VOO"
    And an evaluated symbol "AAPL" with a recent bar on "2026-08-21"
    When the live evaluator evaluates the (strategy, AAPL) pair for "2026-08-21"
    Then "mkt" is resolved from VOO's own live-window bars aligned onto AAPL's timeline
    And if VOO has no bar for "2026-08-21" the benchmark condition evaluates to false (hold), not a crash

  @AC-8 @FR-1 @FR-2
  Scenario: The motivating VOO-200d-rising dip-buy strategy registers and backtests
    Given the dip-buy strategy with entry AND(rsi<35, px>sma200, mkt>0) where mkt is SMA-slope(200,20) on source_symbol "VOO"
    When the strategy is registered via manage_strategy and backtested over "2024-08-01".."2025-08-01"
    Then the backtest completes with a valid status
    And entries fire only on evaluated-symbol bars where VOO's 200-day slope is positive
