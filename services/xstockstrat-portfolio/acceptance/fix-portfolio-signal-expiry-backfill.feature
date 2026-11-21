# Promoted from docs/roadmap/features/359-fix-portfolio-signal-expiry-backfill/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-359 added.

Feature: xstockstrat-portfolio - signal-expiry backfill APPLY never strands a live signal's watchlist entry
  The signal-expiry backfill APPLY serializes each row on the parent watchlist row lock, so a signal added
  concurrently always leaves its SIGNAL watchlist entry tracked by that live signal (feature 359).

  @AC-1 @FR-1 @regression @feature-359
  Scenario: A signal added during backfill APPLY keeps its watchlist entry out of the prune set
    Given a system-managed watchlist with a SIGNAL binding for "META" that has no expiry row and no own watchlist signals
    And a backfill REPORT that classifies that binding as untracked
    When the backfill APPLY runs concurrently with a live watchlist signal for "META" being ingested (valid_until 30 days ahead) and added through AddSymbols with its provenance
    Then the binding's expiry row is either absent or tracked by the live signal (its signal_id and valid_until)
    And a prune tick run afterwards removes nothing from that watchlist
    And a prune tick run after 3 days removes nothing from that watchlist
    And the "META" binding remains with source SIGNAL

  @AC-2 @FR-2 @regression @feature-359
  Scenario: A signal added during a seed APPLY leaves the entry tracked by the new signal, never by the owner's expired one
    Given a system-managed watchlist with a SIGNAL binding for "META" that has no expiry row
    And the owner's own watchlist signal for "META" whose valid_until is already past
    And a backfill REPORT that classifies that binding as a seed with seed_expired Y
    When the backfill APPLY runs concurrently with a live watchlist signal for "META" being ingested (valid_until 30 days ahead) and added through AddSymbols with its provenance
    Then the binding's expiry row has the live signal's signal_id and valid_until
    And a prune tick run afterwards removes nothing from that watchlist
    And the "META" binding remains with source SIGNAL
