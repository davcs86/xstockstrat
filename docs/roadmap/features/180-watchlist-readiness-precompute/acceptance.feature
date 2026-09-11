Feature: watchlist-readiness-precompute
  As a trader opening the watchlist/stock-list page, I want the per-symbol strategy readiness
  overlay to load fast even for large watchlists, so that I don't wait through an end-to-end
  recompute every time I open the page.

  @AC-1 @FR-1
  Scenario: A materialized pair is served from cache with no synchronous recompute
    Given strategy "STR-1" is bound to symbol "AAPL" in a user's watchlist
    And the background materializer has written a fresh readiness_cache row for ("AAPL", "STR-1") with a matching def_fingerprint and valid_until in the future
    When the UI calls EvaluateReadiness with strategyId "STR-1" and symbols ["AAPL"]
    Then the response is served from the FAST (cache-hit) path
    And no marketdata bars fetch, indicator computation, or rule scoring is performed on the request path

  @AC-2 @FR-2
  Scenario: The materialized universe is derived from actual watchlist bindings, owner-scoped
    Given user "U1" has a watchlist binding ("MSFT", "STR-1") and user "U2" has a watchlist binding ("NVDA", "STR-2")
    When the materializer runs one cycle
    Then a readiness_cache row exists for ("MSFT", "STR-1") attributed to U1's binding
    And a readiness_cache row exists for ("NVDA", "STR-2") attributed to U2's binding
    And U1's readiness view never contains a row produced from U2's binding

  @AC-3 @FR-3
  Scenario: A stale materialized row is recomputed rather than served indefinitely
    Given a materialized readiness_cache row exists for ("AAPL", "STR-1") with def_fingerprint "fp-old"
    And strategy "STR-1" is edited so its current def_fingerprint is "fp-new"
    When the materializer next covers ("AAPL", "STR-1")
    Then the readiness_cache row for ("AAPL", "STR-1") is rewritten with def_fingerprint "fp-new"
    And a subsequent EvaluateReadiness for ("AAPL", "STR-1") returns the "fp-new" result

  @AC-4 @FR-4
  Scenario: A large materialization cycle stays within the resource envelope
    Given 500 distinct watchlist-bound (symbol, strategy) pairs exist across all users
    When the materializer runs
    Then concurrent marketdata bars fetches by the materializer never exceed the analysis.readiness_materializer.max_concurrent_bars_fetches limit
    And the materializer's bars fetches use a semaphore separate from the interactive analysis.opportunity.max_concurrent_bars_fetches limit
    And the analysis service holds no more than its configured PgBouncer pool of database connections during the cycle
    And an on-demand EvaluateReadiness call issued during the cycle still returns within its normal latency budget

  @AC-5 @FR-5
  Scenario: An uncovered pair still computes on demand (never a blank overlay)
    Given strategy "STR-3" is bound to symbol "TSLA" in a watchlist
    And no readiness_cache row exists for ("TSLA", "STR-3")
    When the UI calls EvaluateReadiness with strategyId "STR-3" and symbols ["TSLA"]
    Then the response is computed synchronously via the SLOW path and returned
    And a readiness_cache row for ("TSLA", "STR-3") is written for subsequent reads

  @AC-6 @FR-6
  Scenario: A watchlist binding to a non-live strategy is not materialized
    Given strategy "STR-4" is bound to symbol "AMD" in a user's watchlist
    And strategy "STR-4" has live_enabled = false
    When the materializer runs one cycle
    Then no readiness_cache row is materialized for ("AMD", "STR-4")
    And the materializer does not raise or halt the cycle over the non-live binding

  @AC-7 @FR-7
  Scenario: A materialized readiness verdict is busted by a new daily bar, not by intraday drift
    Given a materialized readiness_cache row exists for ("AAPL", "STR-1") stamped with bar_epoch for the 2026-09-04 daily close and a valid_until 24 hours ahead
    When EvaluateReadiness is called for ("AAPL", "STR-1") later the same trading day with no new daily bar
    Then the response is served from the FAST path using the existing row
    When a new daily bar for 2026-09-05 lands and EvaluateReadiness is called for ("AAPL", "STR-1")
    Then the row is treated as stale and the verdict is recomputed against the 2026-09-05 bar
