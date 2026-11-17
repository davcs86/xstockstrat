Feature: fix-portfolio-signal-expiry-backfill (bug fix)
  Regression guard for defect report docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md:
  the signal-expiry backfill APPLY must never leave a SIGNAL watchlist entry due while a live signal for it exists.

  @AC-1 @regression
  Scenario: A signal added during backfill APPLY keeps its watchlist entry out of the prune set
    Given a system-managed watchlist with a SIGNAL binding for "META" that has no expiry row and no own watchlist signals
    And a backfill REPORT that classifies that binding as untracked
    When the backfill APPLY runs concurrently with a live watchlist signal for "META" being ingested (valid_until 30 days ahead) and added through AddSymbols with its provenance
    Then the binding's expiry row is either absent or has a valid_until in the future
    And a prune tick run afterwards removes nothing from that watchlist
    And the "META" binding remains with source SIGNAL
