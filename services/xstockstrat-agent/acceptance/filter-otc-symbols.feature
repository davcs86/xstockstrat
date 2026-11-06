# Promoted from docs/roadmap/features/282-filter-otc-symbols/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-282 added.
# Durable business rules xstockstrat-agent guarantees for surfacing refused unservable symbols in MCP tools.

Feature: xstockstrat-agent — filter OTC symbols
  Agent watchlist tools report refused symbols and reasons instead of silently dropping them.

  @AC-5 @FR-4 @feature-282
  Scenario: A watchlist-direction signal for an unservable symbol is not added
    Given FORL is unservable
    When a signal for FORL is ingested with direction "watchlist" and the agent adds it to the signal watchlist with AddWatchlistSymbols
    Then no watchlist binding is created for FORL
    And the ingest still succeeds
    And the ingest_signal result carries FORL in watchlist_refused

  @AC-18 @FR-2 @feature-282
  Scenario: Agent tools return the refused symbols and reasons
    Given CRTD is unservable and MSFT is servable
    When the agent calls manage_watchlist_symbols add and manage_watchlist create with CRTD and MSFT
    Then each result carries the stored watchlist
    And each result carries CRTD in refused with the reason name "UNSERVABLE_REASON_OTC" or "UNSERVABLE_REASON_NOT_TRADABLE"
