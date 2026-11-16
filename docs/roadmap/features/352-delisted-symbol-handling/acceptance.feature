Feature: delisted-symbol-handling
  As a platform operator, I want a symbol that delists after it was added to be detected, taken out of
  watchlist-driven work and reported with its reason, so that backfill jobs stop ending PARTIAL because
  of dead symbols and I no longer have to find and remove them by hand.

  # The confirmation window is the default of 5 trading days (D-8, D-13). 2026-11-09 is a Monday.

  @AC-1 @FR-1
  Scenario: A symbol unservable for the whole confirmation window is flagged delisted
    Given the confirmation window is 5 trading days
    And "ROKU" is on the user-created watchlist "Tech"
    And "ROKU" has been absent from every loaded asset set since Monday 2026-11-09
    When the asset set is loaded on Friday 2026-11-13 without "ROKU"
    Then "ROKU" is flagged delisted with reason "UNSERVABLE_REASON_NOT_TRADABLE" and first-unservable date 2026-11-09

  @AC-2 @FR-1
  Scenario: A symbol unservable for less than the window is not flagged
    Given the confirmation window is 5 trading days
    And "SHPH" is on the user-created watchlist "Biotech"
    And "SHPH" was first absent from the asset set on 2026-11-16
    When the asset set is loaded on 2026-11-17 without "SHPH"
    Then "SHPH" is not flagged delisted
    And "SHPH" is still requested by watchlist-driven work

  @AC-3 @FR-1
  Scenario: A rejected asset-set refresh is not an observation
    Given the last good asset set holds 13500 assets including "AAPL"
    And "AAPL" is on the user-created watchlist "Tech"
    When a refresh returns 6000 assets without "AAPL" and is rejected as under 50% of the last good set
    Then no absence is recorded for "AAPL"
    And "AAPL" is not flagged delisted

  @AC-4 @FR-2
  Scenario: A flagged symbol that becomes servable again is unflagged
    Given "ATCH" is flagged delisted on the user-created watchlist "Smallcaps"
    When the asset set is loaded with "ATCH" as an active, tradable, non-OTC asset
    Then "ATCH" is no longer flagged delisted on "Smallcaps"
    And "ATCH" is requested by watchlist-driven work again

  @AC-5 @FR-2 @FR-3
  Scenario: Recovery does not re-add a symbol to a system-managed watchlist
    Given "ATCH" was removed from the system-managed watchlist "Signals" when it was flagged delisted
    When the asset set is loaded with "ATCH" as an active, tradable, non-OTC asset
    Then "ATCH" is not on "Signals"
    And "ATCH" is no longer flagged delisted

  @AC-6 @FR-3
  Scenario: A flagged symbol is removed from a system-managed watchlist
    Given "KPTI" is on the system-managed watchlist "Signals"
    When "KPTI" becomes flagged delisted
    Then "KPTI" is no longer on "Signals"
    And "AAPL", also on "Signals" and servable, is still on "Signals"

  @AC-7 @FR-4
  Scenario: A flagged symbol stays on a user-created watchlist, marked
    Given "ROKU" is on the user-created watchlist "Tech"
    When "ROKU" becomes flagged delisted with first-unservable date 2026-11-09
    Then "ROKU" is still on "Tech"
    And the "Tech" entry for "ROKU" carries delisted true, reason "UNSERVABLE_REASON_NOT_TRADABLE" and first-unservable date 2026-11-09
    And the owner can remove "ROKU" from "Tech"

  @AC-8 @FR-5
  Scenario: Watchlist-driven work stops requesting a flagged symbol without a restart
    Given the user-created watchlist "Tech" holds "AAPL" and "ROKU"
    And both symbols are warm in marketdata
    When "ROKU" becomes flagged delisted
    Then "ROKU" is no longer in the warm set, with no service restart
    And the bars stored by the next bar-ingest cycle include "AAPL" and no new bar for "ROKU"
    And the opportunities listed after the next scan of "Tech" include "AAPL" and none for "ROKU"

  @AC-9 @FR-6
  Scenario: Stored history of a flagged symbol stays readable
    Given "NWE" has stored daily bars up to 2026-11-13 and stored fundamentals
    When "NWE" becomes flagged delisted and is removed from "Signals"
    Then a bars query for "NWE" from 2026-01-01 to 2026-11-16 still returns the bar of 2026-11-13
    And a fundamentals query for "NWE" still returns its stored periods

  @AC-10 @FR-6
  Scenario: A held, flagged symbol is still valued
    Given an offline account holds 10 shares of "NWE"
    And "NWE" is flagged delisted
    When the account's positions are read
    Then the "NWE" position carries the same mark as before the flag, from the close of 2026-11-13

  @AC-11 @FR-7
  Scenario: An unresolvable flagged symbol is skipped and the job completes
    Given "PSKY" is flagged delisted
    And SEC's ticker map has no entry for "PSKY"
    When a fundamentals backfill runs for "AAPL" and "PSKY" with start 2021-01-01
    Then the job ends "COMPLETED"
    And "PSKY" has outcome "skipped" and is not in failed_symbols
    And "marketdata.backfill.symbols" with kind "fundamentals" increases by 1 for "skipped" and 0 for "failed"

  @AC-12 @FR-7
  Scenario: A flagged symbol the source still serves is backfilled
    Given "ROKU" is flagged delisted
    And SEC's ticker map still resolves "ROKU"
    When a fundamentals backfill explicitly names "ROKU" with start 2021-01-01
    Then "ROKU" has outcome "written"
    And its periods are stored

  @AC-13 @FR-8
  Scenario: A failing symbol that is not flagged still fails the job
    Given "AXIA" is servable and not flagged delisted
    And SEC's ticker map has no entry for "AXIA"
    When a fundamentals backfill runs for "AAPL" and "AXIA"
    Then "AXIA" has outcome "failed" and is in failed_symbols
    And the job ends "PARTIAL"

  @AC-14 @FR-9 @FR-11
  Scenario: The job status carries the per-symbol reason
    Given a fundamentals backfill for "AAPL", "PSKY" (flagged delisted) and "AXIA" (not flagged) has finished
    And SEC's ticker map has no entry for "PSKY" or "AXIA"
    When get_backfill_status is called for the job
    Then the result lists "PSKY" with outcome "skipped" and a reason containing "no CIK for ticker \"PSKY\""
    And the result lists "AXIA" with outcome "failed" and a reason containing "no CIK for ticker \"AXIA\""

  @AC-15 @FR-10
  Scenario: The watchlist page marks a flagged symbol
    Given "ROKU" is flagged delisted with reason "UNSERVABLE_REASON_NOT_TRADABLE" and first-unservable date 2026-11-09 on the watchlist "Tech"
    When the owner opens "Tech" on the /insights watchlists page
    Then the "ROKU" row shows a delisted marker with the text "not an active, tradable US equity" and the date 2026-11-09
    And the "AAPL" row shows no delisted marker

  @AC-16 @FR-11
  Scenario: The agent watchlist tools return the delisted state
    Given "ROKU" is flagged delisted with first-unservable date 2026-11-09 on the watchlist "Tech"
    When get_watchlist is called for "Tech"
    Then the "ROKU" entry carries delisted true, reason "UNSERVABLE_REASON_NOT_TRADABLE" and first-unservable date 2026-11-09
    And list_watchlists reports the same state for "ROKU" on "Tech"
    And the watchlist returned by manage_watchlist_symbols when "MSFT" is added to "Tech" carries the same state for "ROKU"

  @AC-17 @FR-12
  Scenario: One alert per transition
    Given "KPTI" is on the system-managed watchlist "Signals" and the user-created watchlist "Biotech"
    When "KPTI" becomes flagged delisted
    Then one alert is emitted naming "KPTI", the reason "UNSERVABLE_REASON_NOT_TRADABLE" and the removal from "Signals"
    And the next asset-set refresh, still without "KPTI", emits no further alert for "KPTI"

  @AC-18 @FR-12
  Scenario: Two symbols flagged in the same refresh produce two alerts
    Given "ROKU" and "NWE" are on the system-managed watchlist "Signals"
    When one asset-set refresh flags both "ROKU" and "NWE" delisted
    Then two alerts are emitted, one naming "ROKU" and one naming "NWE"

  @AC-19 @FR-13
  Scenario: The delisted state is one record per symbol, shared by every watchlist
    Given "ROKU" is on the watchlist "Tech" owned by user A and the watchlist "Media" owned by user B
    When "ROKU" becomes flagged delisted with first-unservable date 2026-11-09
    Then the "ROKU" entries on "Tech" and on "Media" both carry delisted true and first-unservable date 2026-11-09
    And after xstockstrat-marketdata restarts, the "ROKU" entries on "Tech" and "Media" still carry delisted true and first-unservable date 2026-11-09

  @AC-20 @FR-1
  Scenario: Days the market is closed do not count toward the window
    Given the confirmation window is 5 trading days
    And "ATCH" is on the user-created watchlist "Smallcaps"
    And "ATCH" was first absent from the asset set on Friday 2026-11-13
    When the asset set is loaded on Wednesday 2026-11-18 without "ATCH"
    Then "ATCH" is not flagged delisted, because only 4 trading days (13, 16, 17, 18 November, counting 13 November as day 1) have elapsed
    And the load on Thursday 2026-11-19 without "ATCH" flags it with first-unservable date 2026-11-13

  @AC-21 @FR-13
  Scenario: A profile row is written lazily
    Given "AAPL" and "ROKU" are on the user-created watchlist "Tech" and neither has a symbol profile row
    When the asset set is loaded on Monday 2026-11-09 with "AAPL" and without "ROKU"
    Then a symbol profile row exists for "ROKU" with first-unservable date 2026-11-09, reason "UNSERVABLE_REASON_NOT_TRADABLE" and delisted false
    And no symbol profile row is created for "AAPL"

  @AC-22 @FR-3
  Scenario: Removal from a system-managed watchlist writes no ledger event
    Given "KPTI" is on the system-managed watchlist "Signals"
    When "KPTI" becomes flagged delisted and is removed from "Signals"
    Then one alert names the removal
    And no ledger event is appended for the removal

  @AC-23 @FR-7
  Scenario: An unresolvable flagged symbol is skipped in a bars backfill
    Given "PSKY" is flagged delisted
    And the bars source answers an error for "PSKY"
    When a bars backfill runs for "AAPL" and "PSKY" from 2026-01-01 to 2026-11-16
    Then the job ends "COMPLETED"
    And "PSKY" has outcome "skipped" and is not in failed_symbols
    And "marketdata.backfill.symbols" with kind "bars" increases by 1 for "skipped" and 0 for "failed"

  @AC-24 @FR-9
  Scenario: A symbol with no data in range is reported empty
    Given "AAPL" is servable and its fundamentals from 2021-01-01 are already stored
    When a fundamentals backfill runs for "AAPL" with start 2021-01-01 and overwrite false and writes 0 periods
    Then get_backfill_status lists "AAPL" with outcome "empty" and no reason
    And the job ends "COMPLETED"

  @AC-25 @FR-1
  Scenario: A symbol that reappears inside the window restarts the count
    Given the confirmation window is 5 trading days
    And "SHPH" is on the user-created watchlist "Biotech"
    And "SHPH" was absent from the asset set on 2026-11-16 and 2026-11-17
    When the asset set is loaded on 2026-11-18 with "SHPH" as an active, tradable, non-OTC asset
    And the asset set is loaded without "SHPH" on every trading day from 2026-11-19
    Then "SHPH" is not flagged delisted on 2026-11-24
    And the load on Wednesday 2026-11-25 flags "SHPH" delisted with first-unservable date 2026-11-19

  @AC-26 @FR-7
  Scenario: A transient source error on a flagged symbol is skipped
    Given "PSKY" is flagged delisted
    And the fundamentals source answers HTTP 429 for "PSKY"
    When a fundamentals backfill runs for "AAPL" and "PSKY" with start 2021-01-01
    Then "PSKY" has outcome "skipped" with a reason containing "429"
    And the job ends "COMPLETED"

  @AC-27 @FR-2 @FR-13
  Scenario: A flag outlives the symbol's last watchlist entry
    Given "PSKY" was flagged delisted and removed from "Signals", its only watchlist
    When the asset set is loaded on the next trading day without "PSKY"
    Then "PSKY" is still flagged delisted in its symbol profile
    And a later load with "PSKY" as an active, tradable, non-OTC asset clears the flag

  @AC-28 @FR-1
  Scenario: A trading day with no successful load still counts as elapsed
    Given the confirmation window is 5 trading days
    And "ROKU" is on the user-created watchlist "Tech"
    And "ROKU" was first absent from the asset set on Monday 2026-11-09
    And no asset-set load succeeded on 2026-11-10 or 2026-11-11
    When the asset set is loaded on Friday 2026-11-13 without "ROKU"
    Then "ROKU" is flagged delisted with first-unservable date 2026-11-09

  @AC-29 @FR-12 @FR-2
  Scenario: Recovery emits one alert
    Given "ATCH" is flagged delisted
    When the asset set is loaded with "ATCH" as an active, tradable, non-OTC asset
    Then one alert is emitted naming "ATCH" as servable again
    And the next asset-set refresh, still with "ATCH", emits no further alert for "ATCH"
