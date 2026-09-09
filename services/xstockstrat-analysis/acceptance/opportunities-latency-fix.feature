@feature-183
Feature: opportunities-latency-fix — analysis service guarantees
  Batch RPCs, concurrent drains, and TTL alignment for ListOpportunities latency.

  @AC-6 @FR-4 @feature-183
  Scenario: Phase 0 drains execute concurrently
    Given _compute_opportunities is invoked for a user with active signals, held positions, watchlist bindings, and source weights
    When Phase 0 runs
    Then all 4 drain calls (_drain_active_signals, _drain_held_symbols, _drain_watchlist_bindings, _drain_source_weights) execute concurrently via asyncio.gather
    And the total Phase 0 wall-clock time is approximately max(individual drain times), not the sum

  @AC-7 @FR-5 @feature-183
  Scenario: Phase 1 uses BatchGetBars instead of per-symbol GetBars
    Given _compute_opportunities Phase 1 needs bars for 50 unique symbols
    When Phase 1 executes
    Then it calls BatchGetBars with all 50 symbols in a single RPC (or bounded chunked calls)
    And it does not call single-symbol GetBars for opportunity compute

  @AC-8 @FR-6 @feature-183
  Scenario: Live enrichment uses batch RPCs instead of per-symbol calls
    Given _enrich_opportunities_live is invoked with 30 unique symbols
    When enrichment executes
    Then it calls BatchGetLatestPrice once for all 30 symbols
    And it calls BatchGetBars once for all 30 symbols (sparkline)
    And it does not acquire _bars_fetch_sem per-symbol for enrichment

  @AC-9 @FR-7 @feature-183
  Scenario: Memo TTL aligns with browser poll interval
    Given the browser polls ListOpportunities every 15 seconds
    And analysis.opportunity.live_enrich_ttl_seconds is at its code default
    When a second poll arrives 15 seconds after the first
    Then the live enrichment memo is still valid (TTL >= 15s)
    And no re-fetch to marketdata occurs for the same symbols
