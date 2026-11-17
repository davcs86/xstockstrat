# Promoted from docs/roadmap/features/356-fix-analysis-held-position-drains/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: fix-analysis-held-position-drains (analysis)

  @AC-1 @FR-1 @FR-4 @FR-6 @regression @feature-356
  Scenario: A drain rejects a next_page_token equal to the one it sent
    Given the portfolio ListPositions fake ignores page_token and always returns position "AAPL" with market_value 100 and next_page_token "t"
    When live_loop._drain_held drains owner "o-1" and servicer._drain_held_symbols drains user "u-1"
    Then each drain makes exactly 2 ListPositions calls instead of 50
    And each drain raises to its caller instead of returning a held set
    And "analysis.live_loop.drain_failures" with source "held" increases by 1 for the live-loop drain

  @AC-2 @FR-2 @FR-4 @regression @feature-356
  Scenario: A drain that reaches its 50-page cap with a token still pending fails loudly
    Given the portfolio ListPositions fake returns a distinct non-empty next_page_token on every page
    When live_loop._drain_held drains owner "o-1" and servicer._drain_held_symbols drains user "u-1"
    Then each drain makes exactly 50 ListPositions calls
    And each drain logs a WARNING naming the owner or user and the cap 50
    And each drain raises to its caller instead of returning a held set
    And "analysis.live_loop.drain_failures" with source "held" increases by 1 for the live-loop drain

  @AC-3 @FR-3 @FR-4 @regression @feature-356
  Scenario: A page error mid-drain is an error, never end-of-data
    Given the portfolio ListPositions fake returns page 1 holding "AAPL" with next_page_token "p2" and then raises on page 2
    When live_loop._drain_held drains owner "o-1" and servicer._drain_held_symbols drains user "u-1"
    Then each drain raises to its caller instead of returning a set or map holding "AAPL"
    And "analysis.live_loop.drain_failures" with source "held" increases by 1 for the live-loop drain

  @AC-4 @FR-3 @FR-4 @feature-356
  Scenario: A non-gRPC exception in the servicer drain is also a failure
    Given the portfolio ListPositions fake raises a non-gRPC exception on page 1
    When servicer._drain_held_symbols drains user "u-1"
    Then the drain raises to its caller instead of returning an empty map

  @AC-5 @FR-4 @regression @feature-356
  Scenario: A failed held drain fails the opportunity recompute and keeps the previous queue
    Given user "u-1" has a previously computed opportunity queue
    And the portfolio ListPositions fake raises on page 1
    When the on-demand opportunity recompute for "u-1" runs
    Then the previous queue for "u-1" is not replaced
    And "analysis.opportunity.recompute" with outcome "failed" increases by 1

  @AC-6 @FR-4 @regression @feature-356
  Scenario: A failed held drain marks no screener row as held
    Given the portfolio ListPositions fake returns page 1 holding "AAPL" with next_page_token "p2" and then raises on page 2
    When ScreenSymbols returns a result row for "AAPL"
    Then the "AAPL" row has held false
    And a WARNING is logged for the failed held cross-reference

  @AC-7 @FR-4 @regression @feature-356
  Scenario: A failed held drain skips only that owner in the live-loop cycle
    Given two live strategies owned by "o-1" and one live strategy owned by "o-2"
    And the portfolio ListPositions fake raises for owner "o-1" and returns "MSFT" for owner "o-2"
    When the live loop runs one cycle
    Then no strategy owned by "o-1" is evaluated in that cycle
    And ListPositions is called exactly once for owner "o-1"
    And "analysis.live_loop.drain_failures" with source "held" increases by exactly 1
    And the strategies owned by "o-2" are evaluated with held set {"MSFT"}
    And no metric attribute contains "o-1"

  @AC-8 @FR-5 @FR-6 @feature-356
  Scenario: A multi-page drain returns every held position exactly once
    Given the portfolio ListPositions fake honors page_token across three pages holding "AAPL" (100), "MSFT" (200) and "NVDA" (300)
    When live_loop._drain_held drains owner "o-1" and servicer._drain_held_symbols drains user "u-1"
    Then live_loop._drain_held returns {"AAPL", "MSFT", "NVDA"}
    And servicer._drain_held_symbols returns {"AAPL": 100, "MSFT": 200, "NVDA": 300}
    And each drain makes exactly 3 ListPositions calls

  @AC-9 @FR-5 @feature-356
  Scenario: A single-page drain is unchanged
    Given the portfolio ListPositions fake returns one page holding "AAPL" with market_value -150 and an empty next_page_token
    When live_loop._drain_held drains owner "o-1" and servicer._drain_held_symbols drains user "u-1"
    Then live_loop._drain_held returns {"AAPL"}
    And servicer._drain_held_symbols returns {"AAPL": 150}
    And each drain makes exactly 1 ListPositions call

  @AC-10 @FR-4 @regression @feature-356
  Scenario: A failed daily-refresh user is counted and keeps the previous queue
    Given users "u-1" and "u-2" each have a previously computed opportunity queue
    And the portfolio ListPositions fake raises for "u-1" and returns an empty page for "u-2"
    When the daily opportunity refresh pass runs
    Then the previous queue for "u-1" is not replaced
    And the queue for "u-2" is replaced
    And "analysis.opportunity.recompute" with kind "full" and outcome "failed" increases by exactly 1
    And no metric attribute contains "u-1"
    And the refresh schedule advances
