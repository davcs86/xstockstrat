# Promoted from docs/roadmap/features/185-opportunity-compute-robustness/acceptance.feature at
# code-completion (Constitution C-16). Source-feature provenance on every scenario's `@feature-185` tag.
# Durable business rules xstockstrat-analysis guarantees for the opportunities compute + surgical
# read-time recovery: a data-unavailable symbol carries an explicit terminal sentinel distinct from an
# evaluated-quiet 0/N, the sentinel survives persistence, a background recompute never starves an
# interactive read, a cold read is non-blocking with a "computing" signal, a persistently-failing cold
# compute lands a terminal error, and a stale unavailable row self-heals surgically (readiness cache
# refreshed success-only). (AC-3 is the /insights render → promoted to the ui suite; AC-10 is the
# list_opportunities MCP projection → promoted to the agent suite.)

Feature: opportunity-compute-robustness (analysis-service guarantees)
  What xstockstrat-analysis guarantees for opportunity compute robustness: data-unavailable symbols are
  explicitly marked (never a misleadingly-quiet 0/0), the sentinel is persistence-stable, interactive
  reads stay responsive under a concurrent background recompute, cold/failed compute states are
  distinguishable and bounded, and unavailable rows self-heal via a surgical, cooldown-gated recompute.

  @AC-1 @FR-1 @feature-185
  Scenario: A data-unavailable symbol is marked unavailable, not evaluated-0/0
    Given a candidate symbol whose bars/indicator fetch fails during an opportunities compute
    When the queue is materialized and ListOpportunities is read
    Then that symbol's row carries the terminal data-unavailable sentinel
    And it is distinguishable from a symbol that was evaluated with 0 of N conditions passing

  @AC-2 @FR-1 @feature-185
  Scenario: An evaluated-but-not-passing symbol is NOT marked unavailable
    Given a candidate symbol whose bars are available and 0 of 3 conditions pass
    When the queue is materialized
    Then that symbol is classified quiet/0-of-3 (evaluated), not data-unavailable

  @AC-4 @FR-3 @feature-185
  Scenario: A background recompute does not starve an interactive read
    Given a background opportunities recompute is running its bars-fetch fan-out
    When an interactive ListOpportunities read enriches live quotes at the same time
    Then the interactive read's bars-fetch concurrency is governed by a semaphore separate from the background compute's
    And the two do not contend on the same semaphore permits

  @AC-5 @FR-1 @feature-185
  Scenario: The sentinel survives the materialization round-trip
    Given a data-unavailable candidate is written to analysis.opportunities during a compute
    When the row is read back by a later ListOpportunities without recompute
    Then the data-unavailable sentinel is still present on the row (not lost through persistence)

  @AC-6 @FR-4 @feature-185
  Scenario: A cold read is non-blocking and distinguishable from an empty universe
    Given a user who has never had opportunities materialized
    When ListOpportunities is called
    Then it returns an empty page with the "computing" pending signal set (not a synchronous compute wait)
    And a background recompute is kicked
    And a user whose universe is legitimately empty returns an empty page with "computing" NOT set

  @AC-7 @FR-4 @feature-185
  Scenario: A persistently-failing cold compute renders a terminal error, not an infinite spinner
    Given a cold user whose background recompute keeps failing
    When ListOpportunities is polled repeatedly
    Then after the bounded attempts it returns a terminal compute-failed state (not "computing" forever)

  @AC-8 @FR-5 @feature-185
  Scenario: A data-unavailable row self-heals via a surgical read-time recompute
    Given a served data-unavailable row older than the 300s retry cooldown
    When ListOpportunities is read and market data has recovered
    Then only that symbol's rows are re-fetched and re-evaluated (not the full universe)
    And the row heals in place with both conviction and signal_axis restored (signal_axis re-drained, not left 0)
    And a still-unavailable symbol has its computed_at re-stamped so it does not re-kick before the next 300s

  @AC-9 @FR-5 @feature-185
  Scenario: A recovered watchlist-entry symbol also refreshes the readiness cache
    Given a recovered symbol that participates in a watchlist x strategy entry-rule readiness
    When the surgical recovery re-evaluates it successfully
    Then the fresh readiness rows for that (symbol, strategy, entry) subset are upserted to analysis.readiness_cache
    And a symbol whose re-fetch still fails is NOT written to the readiness cache (success-only)
