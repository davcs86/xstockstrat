# Promoted from docs/roadmap/features/352-delisted-symbol-handling/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-352 added.
# Durable business rules xstockstrat-portfolio guarantees for flagged-delisted symbols on watchlists, delisting alerts, and held-position valuation.

Feature: xstockstrat-portfolio — delisted symbol handling
  Portfolio removes flagged symbols from system-managed watchlists, marks them on user-created ones, alerts once per transition, and keeps valuing held positions.

  # The confirmation window is the default of 5 trading days (D-8, D-13). 2026-11-09 is a Monday.

  Background:
    Given xstockstrat-portfolio's delisting refresh runs after every watchlist change and after every asset-set load
    And every asset-set load in these scenarios that names no date runs on a trading day

  @AC-5 @FR-2 @FR-3 @feature-352
  Scenario: Recovery does not re-add a symbol to a system-managed watchlist
    Given "ATCH" was removed from the system-managed watchlist "Signals" when it was flagged delisted
    When the asset set is loaded with "ATCH" as an active, tradable, non-OTC asset
    Then "ATCH" is not on "Signals"
    And "ATCH" is no longer flagged delisted

  @AC-6 @FR-3 @feature-352
  Scenario: A flagged symbol is removed from a system-managed watchlist
    Given "KPTI" is on the system-managed watchlist "Signals"
    When "KPTI" becomes flagged delisted
    Then "KPTI" is no longer on "Signals"
    And "AAPL", also on "Signals" and servable, is still on "Signals"

  @AC-7 @FR-4 @feature-352
  Scenario: A flagged symbol stays on a user-created watchlist, marked
    Given "ROKU" is on the user-created watchlist "Tech"
    When "ROKU" becomes flagged delisted with first-unservable date 2026-11-09
    Then "ROKU" is still on "Tech"
    And the "Tech" entry for "ROKU" carries delisted true, reason "UNSERVABLE_REASON_NOT_TRADABLE" and first-unservable date 2026-11-09
    And the owner can remove "ROKU" from "Tech"

  @AC-10 @FR-6 @feature-352
  Scenario: A held, flagged symbol is still valued
    Given an offline account holds 10 shares of "NWE"
    And "NWE" is flagged delisted
    When the account's positions are read
    Then the "NWE" position carries the same mark as before the flag, from the close of 2026-11-13

  @AC-17 @FR-12 @feature-352
  Scenario: One alert per transition
    Given "KPTI" is on the system-managed watchlist "Signals" and the user-created watchlist "Biotech"
    When "KPTI" becomes flagged delisted
    Then one alert is emitted naming "KPTI", the reason "UNSERVABLE_REASON_NOT_TRADABLE" and the removal from "Signals"
    And the next asset-set refresh, still without "KPTI", emits no further alert for "KPTI"

  @AC-18 @FR-12 @feature-352
  Scenario: Two symbols flagged in the same refresh produce two alerts
    Given "ROKU" and "NWE" are on the system-managed watchlist "Signals"
    When one asset-set refresh flags both "ROKU" and "NWE" delisted
    Then two alerts are emitted, one naming "ROKU" and one naming "NWE"

  @AC-22 @FR-3 @feature-352
  Scenario: Removal from a system-managed watchlist writes no ledger event
    Given "KPTI" is on the system-managed watchlist "Signals"
    When "KPTI" becomes flagged delisted and is removed from "Signals"
    Then one alert names the removal
    And no ledger event is appended for the removal
