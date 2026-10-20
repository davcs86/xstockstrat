# Promoted from docs/roadmap/features/240-offline-account-full-pnl/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-240` tag.
# Durable business rules xstockstrat-marketdata already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata - BatchGetBars allow_partial opt-in degradation
  A caller that opts in with allow_partial gets the stored bars when the live fetch fails or stalls;
  strict callers keep the fail-the-RPC behaviour.

  @AC-53 @FR-5 @feature-240
  Scenario Outline: allow_partial opts in to returning stored bars when the live fetch fails
    Given the read time is "2026-10-19T15:00:00Z"
    And marketdata.ohlcv holds 1d bars for AAPL on sessions 2026-10-14, 2026-10-15 and 2026-10-16, and none for ZZZZ
    And the live bar fetch returns an error
    When BatchGetBars is called with symbols [AAPL, ZZZZ], timeframe "1d", start "2026-10-13T00:00:00Z", end "2026-10-19T15:00:00Z" and allow_partial <flag>
    Then <outcome>

    Examples:
      | flag  | outcome                                                                          |
      | true  | the call succeeds with results for AAPL only, holding 3 bars                     |
      | false | the call fails with gRPC status INTERNAL whose message carries the live-fetch error |

  @AC-54 @FR-5 @feature-240
  Scenario: allow_partial budgets the live fetch from the caller's deadline
    Given the read time is "2026-10-19T15:00:00Z"
    And marketdata.ohlcv holds 1d bars for AAPL on sessions 2026-10-14, 2026-10-15 and 2026-10-16, and none for ZZZZ
    And the live bar fetch never answers
    When BatchGetBars is called with symbols [AAPL, ZZZZ], timeframe "1d", start "2026-10-13T00:00:00Z", end "2026-10-19T15:00:00Z", allow_partial true and a 1000 ms caller deadline
    Then the call succeeds within the 1000 ms deadline with results for AAPL only, holding 3 bars
