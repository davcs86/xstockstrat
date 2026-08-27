# Promoted from docs/roadmap/features/154-fundsignal-watchlist-universe/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-154` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. These cover portfolio's
# cross-user watchlist-symbol enumeration RPC (ListAllWatchlistSymbols) and its first authz gate.

Feature: xstockstrat-portfolio — cross-user watchlist-symbol enumeration
  What portfolio guarantees for the cross-user watchlist enumeration RPC that sources the fundamentals
  producer's universe: a distinct union across all users, gated to allow-listed internal callers.

  @AC-1 @FR-1 @feature-154
  Scenario: Portfolio enumerates the distinct cross-user union of watchlist symbols
    Given user "alice" has a watchlist containing "AAPL, MSFT"
    And user "bob" has a watchlist containing "MSFT, NVDA"
    When an authorized internal caller invokes the cross-user watchlist-symbol enumeration RPC
    Then the response contains exactly the distinct set {"AAPL", "MSFT", "NVDA"}
    And "MSFT" appears once, not twice

  @AC-2 @FR-2 @feature-154
  Scenario: The enumeration RPC rejects a non-privileged caller
    Given a caller whose propagated metadata carries neither the admin access-scope bit nor an allow-listed internal-caller identity
    When it invokes the cross-user watchlist-symbol enumeration RPC
    Then the call fails with PERMISSION_DENIED
    And no watchlist symbols are returned
