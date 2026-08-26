# Promoted from docs/roadmap/features/127-consolidate-watchlist-signal/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-127` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-portfolio — system-managed signals watchlist
  What portfolio guarantees for the per-user system-managed signals watchlist: EnsureSignalWatchlist
  is idempotent (one system_managed list per user, found by flag not name) and coexists with a
  user's own same-named manual list.

  @AC-6 @FR-2 @FR-7 @feature-127
  Scenario: EnsureSignalWatchlist is idempotent and coexists with a same-named manual list
    Given the caller "user-42" already owns a manual watchlist named "Signals"
    When EnsureSignalWatchlist is called twice for "user-42"
    Then both calls return the same watchlist id
    And exactly one system_managed=true watchlist exists for "user-42"
    And it coexists with the caller's manual "Signals" list
