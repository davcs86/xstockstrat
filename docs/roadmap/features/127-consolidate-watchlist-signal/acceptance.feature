# Acceptance scenarios for feature 127 — consolidate-watchlist-signal.
# @AC-* IDs are append-only; each Scenario traces to a test step at /sdd-spec (Constitution C-15).
# Behavior reflects the design-approved system-managed watchlist (identified by a system_managed flag,
# not a name), the EnsureSignalWatchlist RPC, the DeleteWatchlist guard, and the UI distinctions.

Feature: Consolidate "watchlist"-direction signals into the portfolio watchlist
  As an MCP-agent user, when I ingest a signal with direction="watchlist" the symbol is added
  to my system-managed signals watchlist, so the label has a real, visible effect instead of
  being stored as an inert value.

  @AC-1 @FR-1 @FR-2
  Scenario: A watchlist-direction signal adds the symbol to the caller's system-managed watchlist
    Given the authenticated caller "user-42" has no NVDA entry in their system-managed signals watchlist
    When ingest_signal is called with direction="watchlist" for symbol "NVDA" and the response has deduplicated=false
    Then NVDA appears in the caller's system-managed signals watchlist bindings
    And that binding's source is WATCHLIST_ENTRY_SOURCE_SIGNAL

  @AC-2 @FR-6
  Scenario: Non-watchlist directions cause no watchlist mutation
    When ingest_signal is called with direction="buy" for symbol "NVDA"
    Then no watchlist binding is created or changed for the caller

  @AC-3 @FR-4
  Scenario: A deduplicated ingest does not re-trigger the auto-add
    When ingest_signal is called with direction="watchlist" for symbol "NVDA" and the response has deduplicated=true
    Then no watchlist binding is created or changed for the caller

  @AC-4 @FR-3
  Scenario: A portfolio failure never fails the already-committed ingest
    Given xstockstrat-portfolio is unreachable
    When ingest_signal is called with direction="watchlist" for symbol "NVDA"
    Then the call returns successfully with a signal_id
    And no exception propagates to the ingest_signal caller
    And a WARN-level log line records the portfolio failure with its original gRPC code

  @AC-5 @FR-5
  Scenario: The tool docstring and mcp-tools.md both document the watchlist side effect
    When the ingest_signal docstring SIDE EFFECT block and the docs/runbooks/mcp-tools.md ingest_signal entry are read
    Then both surfaces mention the watchlist auto-add side effect

  @AC-6 @FR-2 @FR-7
  Scenario: EnsureSignalWatchlist is idempotent and coexists with a same-named manual list
    Given the caller "user-42" already owns a manual watchlist named "Signals"
    When EnsureSignalWatchlist is called twice for "user-42"
    Then both calls return the same watchlist id
    And exactly one system_managed=true watchlist exists for "user-42"
    And it coexists with the caller's manual "Signals" list

  @AC-7 @FR-8 @FR-9
  Scenario: A system-managed watchlist cannot be deleted via API or UI
    Given the caller "user-42" owns a system_managed watchlist
    When DeleteWatchlist is called for that watchlist
    Then the RPC returns FAILED_PRECONDITION
    And the watchlist still exists
    And on /insights/watchlists the delete affordance for that watchlist is hidden or disabled
    And its rename, add-symbol, and remove-symbol affordances remain enabled

  @AC-8 @FR-10
  Scenario: Signal-sourced entries render a provenance badge, manual ones do not
    Given a system-managed watchlist contains NVDA with source WATCHLIST_ENTRY_SOURCE_SIGNAL and MSFT with source WATCHLIST_ENTRY_SOURCE_MANUAL
    When /insights/watchlists renders that watchlist
    Then the NVDA entry shows a signal-provenance badge
    And the MSFT entry shows no such badge
