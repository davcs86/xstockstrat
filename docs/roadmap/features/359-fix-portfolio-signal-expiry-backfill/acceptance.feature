Feature: fix-portfolio-signal-expiry-backfill (bug fix)
  Regression guard for defect report docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md:
  the signal-expiry backfill APPLY must never leave a SIGNAL watchlist entry due while a live signal for it exists.

  @AC-1 @FR-1 @regression
  Scenario: A signal added during backfill APPLY keeps its watchlist entry out of the prune set
    Given a system-managed watchlist with a SIGNAL binding for "META" that has no expiry row and no own watchlist signals
    And a backfill REPORT that classifies that binding as untracked
    When the backfill APPLY runs concurrently with a live watchlist signal for "META" being ingested (valid_until 30 days ahead) and added through AddSymbols with its provenance
    Then the binding's expiry row is either absent or has a valid_until in the future
    And a prune tick run afterwards removes nothing from that watchlist
    And the "META" binding remains with source SIGNAL

  @AC-2 @FR-2 @regression
  Scenario: A signal added during a seed APPLY leaves the entry tracked by the new signal, never by the owner's expired one
    Given a system-managed watchlist with a SIGNAL binding for "META" that has no expiry row
    And the owner's own watchlist signal for "META" whose valid_until is already past
    And a backfill REPORT that classifies that binding as a seed with seed_expired Y
    When the backfill APPLY runs concurrently with a live watchlist signal for "META" being ingested (valid_until 30 days ahead) and added through AddSymbols with its provenance
    Then the binding's expiry row has the live signal's signal_id and valid_until
    And a prune tick run afterwards removes nothing from that watchlist
    And the "META" binding remains with source SIGNAL

  @AC-3 @FR-3
  Scenario: A backfill untracked mark gets a 3-day grace before pruning
    Given a system-managed watchlist with a SIGNAL binding for "PLTR" that has no expiry row and no own watchlist signals
    And a backfill REPORT that classifies that binding as untracked
    When the backfill APPLY marks it
    Then the binding's expiry row has signal_id NULL and valid_until 3 days after APPLY
    And a prune tick run within those 3 days removes nothing from that watchlist
    And a prune tick run after those 3 days removes "PLTR" with a signal_entry_removed_untracked event
