# Promoted from docs/roadmap/features/177-readiness-caching-poll-discipline/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-177`
# tag. Durable business rules xstockstrat-analysis already guarantees — a rule enters only by
# promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: readiness-caching-poll-discipline
  What xstockstrat-analysis guarantees for decide-surface read discipline: repeated EvaluateReadiness
  and ListOpportunities reads serve cached/materialized results within an explicit staleness window
  instead of recomputing from scratch, while a new bar, an empty-universe TTL lapse, or stale
  enrichment always busts the cache — never presenting stale data as fresh.

  @AC-1 @FR-1 @FR-5 @feature-177
  Scenario: A repeat readiness call within the freshness window skips the fan-out
    Given EvaluateReadiness was computed for strategy S over symbols [AAPL, MSFT] at bar epoch E
    And no new bar has landed since E
    When EvaluateReadiness is called again for S over [AAPL, MSFT]
    Then the response is served from cache with no new marketdata GetBars or indicator RPCs
    And the response carries a computed-at no older than the configured staleness window

  @AC-2 @FR-1 @FR-5 @feature-177
  Scenario: A new bar busts the readiness cache
    Given a cached readiness result for strategy S at bar epoch E
    When a new daily bar lands advancing the epoch to E+1
    And EvaluateReadiness is called for S
    Then the cache is treated as stale and a fresh compute runs
    And the returned verdict reflects the E+1 bar

  @AC-4 @FR-3 @feature-177
  Scenario: An empty-universe user does not recompute on every poll
    Given a user whose opportunity universe legitimately yields zero opportunities
    When the Opportunities page polls ListOpportunities 4 times over 60 seconds
    Then the full synchronous opportunity compute runs at most once for that window
    And the subsequent polls return the cached empty result without recomputing

  @AC-5 @FR-4 @feature-177
  Scenario: Warm reads skip live enrichment when values are fresh
    Given a materialized opportunity queue whose enriched prices were refreshed within the staleness window
    When ListOpportunities serves that warm queue on a routine poll
    Then it does not issue the per-symbol GetLatestPrice + GetBars enrichment calls
    And it issues them only when the enriched values are stale
