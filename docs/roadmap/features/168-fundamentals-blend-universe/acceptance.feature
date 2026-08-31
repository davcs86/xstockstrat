Feature: fundamentals-blend-universe
  As the platform (on behalf of every user with the blend strategy enabled), I want
  fundamentals_macd_blend to be evaluated on exactly the fundamentals universe — symbols with a live
  source == "fundamentals" signal that also have actual fundamentals — in addition to the user's
  selected strategies, so that the blend strategy runs where it is meant to and nowhere else.

  @AC-1 @FR-1 @FR-3 @FR-4
  Scenario: Blend strategy runs on the fundamentals universe intersection
    Given active fundamentals signals exist for symbols AAPL, MSFT, ZZZZ (source "fundamentals")
    And GetFundamentalsMulti returns fundamentals rows for AAPL and MSFT but not for ZZZZ
    And a live strategy "fundamentals_macd_blend" is enabled
    When the live evaluation loop runs a cycle
    Then fundamentals_macd_blend is evaluated for AAPL and MSFT
    And fundamentals_macd_blend is not evaluated for ZZZZ

  @AC-2 @FR-2
  Scenario: Blend strategy is excluded from symbols outside the fundamentals universe
    Given user "u-1" has a watchlist containing GME and a held position in AMC
    And neither GME nor AMC has an active "fundamentals" signal
    And a live strategy "fundamentals_macd_blend" is enabled for "u-1"
    When the live evaluation loop runs a cycle
    Then fundamentals_macd_blend is not evaluated for GME or AMC
    And fundamentals_macd_blend is only evaluated on symbols in the fundamentals universe

  @AC-3 @FR-1
  Scenario: Blend runs in addition to the user's selected strategy
    Given user "u-1" has a live strategy "sma_cross" over a watchlist containing AAPL and GME
    And AAPL is in the fundamentals universe and GME is not
    And "fundamentals_macd_blend" is enabled
    When the live evaluation loop runs a cycle
    Then sma_cross is evaluated for both AAPL and GME (its own universe is unchanged)
    And fundamentals_macd_blend is additionally evaluated for AAPL only

  @AC-4 @FR-5
  Scenario: Rule is a no-op when the configured blend strategy is not live
    Given the config analysis.engine.fundamentals_blend_strategy_id is "fundamentals_macd_blend"
    And no live strategy with id "fundamentals_macd_blend" is enabled
    When the live evaluation loop runs a cycle
    Then no fundamentals-universe forced evaluation occurs
    And the cycle completes without error

  @AC-5 @FR-5
  Scenario: Config can retarget the rule to a different strategy id
    Given the config analysis.engine.fundamentals_blend_strategy_id is set to "fund_blend_v2"
    And a live strategy "fund_blend_v2" is enabled and AAPL is in the fundamentals universe
    When the live evaluation loop runs a cycle
    Then fund_blend_v2 is evaluated for AAPL as the fundamentals-universe strategy
    And a strategy still named "fundamentals_macd_blend" is treated as an ordinary strategy with its normal universe

  @AC-6 @FR-6
  Scenario: Fundamentals-universe resolution failure yields an empty universe, not a broad fallback
    Given a live strategy "fundamentals_macd_blend" is enabled for user "u-1" with a watchlist containing AAPL and TSLA
    And QuerySignals(source="fundamentals") raises an error this cycle
    When the live evaluation loop runs a cycle
    Then fundamentals_macd_blend is evaluated on zero symbols this cycle (not on AAPL or TSLA)
    And the user's other live strategies still evaluate normally
