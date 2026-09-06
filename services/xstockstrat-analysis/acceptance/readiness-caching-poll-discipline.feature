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

  # feature 181: GetWatchlistReadiness cache-first decoration must obey the same bar_epoch bust the
  # interactive/materialized paths do — the four-way classifier never serves a bar-busted row as a
  # stale RESOLVED. (Also promotes the feature-180 FAST/bar_epoch guarantee into this durable suite:
  # a materialized row is governed by the same bar_epoch-aware freshness gate, recon R3 / design R-A.)
  @AC-3 @feature-181 @feature-180
  Scenario: A bar-busted watchlist-readiness row is decorated PENDING, never a stale RESOLVED
    Given a cached readiness row for a watchlist's (symbol, strategy) pair at bar epoch E
    When a new daily bar advances the coverage probe to E+1
    And GetWatchlistReadiness decorates that pair from the cache
    Then the row is decorated PENDING (not a stale RESOLVED) and a background refresh is kicked
    And a subsequent poll after the refresh serves the pair RESOLVED at the E+1 bar

  @AC-2 @feature-181
  Scenario: A data-unavailable readiness row is decorated UNKNOWN, not perpetual PENDING
    Given a readiness row whose primary bars fetch persistently failed (bar_epoch = -1 sentinel)
    When GetWatchlistReadiness decorates that pair from the cache
    Then the row is decorated UNKNOWN rather than looping forever on PENDING
    And it is re-kicked only after the UNKNOWN recovery cooldown elapses
