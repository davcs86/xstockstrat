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

  # Promoted from docs/roadmap/features/289-fix-analysis-admin-formula-refusal/acceptance.feature
  # (Constitution C-16). Every @feature-289 scenario below assumes that feature's Background:
  #   Given admin user "admin-1" (x-access-scope admin) owns live strategies "s-1" and "s-2", both bound to symbol "MYSZ" (and "s-2" also to symbol "AAPL")
  #   And a component formula "f-9" of "s-1" is authored by user "user-2", while all components of "s-2" are readable by "admin-1"
  #   And the entry rule of "s-1" references "f-9"
  # "the unreadable-formula marker" is the bool formula_unreadable (Opportunity field 25, SymbolReadiness field 6; provenance token and readiness_json key "formula_unreadable").

  @AC-2 @FR-3 @regression @feature-289
  Scenario: EvaluateReadiness degrades per symbol instead of aborting
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When "admin-1" calls EvaluateReadiness for "MYSZ" with strategy "s-1"
    Then the RPC returns status OK with a result for "MYSZ" showing 0 of 0 conditions and the unreadable-formula marker
    And no ERROR "Unexpected [AioRpcError] raised by servicer method" is logged

  @AC-3 @FR-3 @regression @feature-289
  Scenario: The cache-only watchlist readiness read serves a resolved unreadable entry
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    And the watchlist of "admin-1" holds "MYSZ" (bound to "s-1") and "AAPL" (bound to "s-2")
    And the background readiness refresh for "admin-1" has completed
    When GetWatchlistReadiness is called
    Then the "MYSZ" entry is RESOLVED with 0 of 0 conditions and the unreadable-formula marker, not UNKNOWN or PENDING
    And the "AAPL" entry is also RESOLVED (one unreadable symbol does not discard the batch)
    And no "readiness refresh kick failed" warning is logged

  @AC-8 @FR-3 @regression @feature-289
  Scenario: The readiness materializer persists the unreadable verdict and continues (defense in depth)
    # The materializer's metadata is owner-only (no admin scope), so indicators does not normally answer PERMISSION_DENIED
    # there; this guards the stub-level behaviour should the scope ever propagate.
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED and the watchlist of "admin-1" holds "MYSZ" (bound to "s-1") and "AAPL" (bound to "s-2")
    When the readiness materializer runs for "admin-1"
    Then the persisted readiness verdict for "MYSZ" under "s-1" is 0 of 0 conditions with the unreadable-formula marker and is served as fresh (not stale, not the data-unavailable sentinel)
    And the pass continues so that the "AAPL" entry is also written

  @AC-13 @FR-5 @characterization @feature-289
  Scenario: A formula execution timeout still aborts EvaluateReadiness
    Given indicators ExecuteFormula for a component of "s-2" responds success=false with error "Formula execution timed out after 5000ms" (not an RPC deadline)
    When "admin-1" calls EvaluateReadiness for "MYSZ" with strategy "s-2"
    Then the RPC fails with an unhandled-error status and ERROR "Unexpected [FormulaExecutionError]" is logged, as before feature 289, and the timeout is not converted into a 0 of 0 unreadable-formula result

  @AC-19 @FR-1 @FR-3 @regression @feature-289
  Scenario: The daily refresh and the readiness materializer (owner-only metadata) persist the marker
    Given indicators answers ExecuteFormula for "f-9" with NOT_FOUND because the caller carries no admin scope
    When the daily opportunity refresh and the readiness materializer run for "admin-1"
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker
    And the readiness_cache entry for (admin-1, s-1, entry, MYSZ) is 0 of 0 with the marker and a bar_epoch >= 0

  @AC-20 @FR-3 @regression @feature-289
  Scenario: A repeated EvaluateReadiness within the stale window still carries the marker
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    When "admin-1" calls EvaluateReadiness for "MYSZ" with strategy "s-1" twice within stale_after_seconds
    Then both results are OK, 0 of 0 with the unreadable-formula marker, and the second is served without calling indicators
