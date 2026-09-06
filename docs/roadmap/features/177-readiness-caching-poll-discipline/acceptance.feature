Feature: readiness-caching-poll-discipline
  As a user watching the Opportunities and Watchlist panes, I want repeated reads and background polls
  to serve cached results instead of recomputing from scratch, so lists appear promptly and the
  backend isn't repeating the same work on every tick for every open tab.

  @AC-1 @FR-1 @FR-5
  Scenario: A repeat readiness call within the freshness window skips the fan-out
    Given EvaluateReadiness was computed for strategy S over symbols [AAPL, MSFT] at bar epoch E
    And no new bar has landed since E
    When EvaluateReadiness is called again for S over [AAPL, MSFT]
    Then the response is served from cache with no new marketdata GetBars or indicator RPCs
    And the response carries a computed-at no older than the configured staleness window

  @AC-2 @FR-1 @FR-5
  Scenario: A new bar busts the readiness cache
    Given a cached readiness result for strategy S at bar epoch E
    When a new daily bar lands advancing the epoch to E+1
    And EvaluateReadiness is called for S
    Then the cache is treated as stale and a fresh compute runs
    And the returned verdict reflects the E+1 bar

  @AC-3 @FR-2
  Scenario: Remounting the watchlist detail pane within staleTime does not refetch
    Given the readiness useQueries staleTime is 30 seconds
    And the watchlist detail pane was rendered 10 seconds ago
    When the user switches away and back to the same watchlist
    Then no new EvaluateReadiness request is issued to the BFF

  @AC-4 @FR-3
  Scenario: An empty-universe user does not recompute on every poll
    Given a user whose opportunity universe legitimately yields zero opportunities
    When the Opportunities page polls ListOpportunities 4 times over 60 seconds
    Then the full synchronous opportunity compute runs at most once for that window
    And the subsequent polls return the cached empty result without recomputing

  @AC-5 @FR-4
  Scenario: Warm reads skip live enrichment when values are fresh
    Given a materialized opportunity queue whose enriched prices were refreshed within the staleness window
    When ListOpportunities serves that warm queue on a routine poll
    Then it does not issue the per-symbol GetLatestPrice + GetBars enrichment calls
    And it issues them only when the enriched values are stale
