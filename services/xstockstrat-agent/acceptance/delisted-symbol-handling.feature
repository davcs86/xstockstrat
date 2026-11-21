# Promoted from docs/roadmap/features/352-delisted-symbol-handling/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-352 added.
# Durable business rules xstockstrat-agent guarantees for surfacing the delisted state and per-symbol backfill outcomes in MCP tools.

Feature: xstockstrat-agent — delisted symbol handling
  Agent watchlist tools return the delisted state and get_backfill_status returns per-symbol outcomes with reasons.

  @AC-14 @FR-9 @FR-11 @feature-352
  Scenario: The job status carries the per-symbol reason
    Given a fundamentals backfill for "AAPL", "PSKY" (flagged delisted) and "AXIA" (not flagged) has finished
    And SEC's ticker map has no entry for "PSKY" or "AXIA"
    When get_backfill_status is called for the job
    Then the result lists "PSKY" with outcome "skipped" and a reason containing "no CIK for ticker \"PSKY\""
    And the result lists "AXIA" with outcome "failed" and a reason containing "no CIK for ticker \"AXIA\""

  @AC-16 @FR-11 @feature-352
  Scenario: The agent watchlist tools return the delisted state
    Given "ROKU" is flagged delisted with first-unservable date 2026-11-09 on the watchlist "Tech"
    When get_watchlist is called for "Tech"
    Then the "ROKU" entry carries delisted true, reason "UNSERVABLE_REASON_NOT_TRADABLE" and first-unservable date 2026-11-09
    And list_watchlists reports the same state for "ROKU" on "Tech"
    And the watchlist returned by manage_watchlist_symbols when "MSFT" is added to "Tech" carries the same state for "ROKU"

  @AC-24 @FR-9 @feature-352
  Scenario: A symbol with no data in range is reported empty
    Given "AAPL" is servable and its fundamentals from 2021-01-01 are already stored
    When a fundamentals backfill runs for "AAPL" with start 2021-01-01 and overwrite false and writes 0 periods
    Then get_backfill_status lists "AAPL" with outcome "empty" and no reason
    And the job ends "COMPLETED"
