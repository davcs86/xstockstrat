# Promoted from docs/roadmap/features/127-consolidate-watchlist-signal/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-127` tag.
# Durable business rules xstockstrat-ui already guarantees — a rule enters only by promotion from a
# reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-ui — watchlist entry provenance badge
  What the /insights/watchlists surface guarantees: signal-sourced entries render a provenance badge
  and manual ones do not.

  @AC-8 @FR-10 @feature-127
  Scenario: Signal-sourced entries render a provenance badge, manual ones do not
    Given a system-managed watchlist contains NVDA with source WATCHLIST_ENTRY_SOURCE_SIGNAL and MSFT with source WATCHLIST_ENTRY_SOURCE_MANUAL
    When /insights/watchlists renders that watchlist
    Then the NVDA entry shows a signal-provenance badge
    And the MSFT entry shows no such badge
