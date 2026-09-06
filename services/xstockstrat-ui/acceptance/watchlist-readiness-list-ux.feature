# Promoted from docs/roadmap/features/181-watchlist-readiness-list-ux/acceptance.feature at
# code-completion (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-181` tag. Durable business rules xstockstrat-ui guarantees for the /insights/watchlists
# readiness list — a rule enters only by promotion from a reviewed feature acceptance.feature.

Feature: watchlist-readiness-list-ux
  What xstockstrat-ui guarantees for the /insights/watchlists readiness list: rows render immediately
  with a per-row loading state, the readiness verdict is decorated by one page-bounded RPC (no client
  per-strategy EvaluateReadiness fan-out), the bound rows paginate, and the new states use the
  canonical C-17 primitives with the a11y baseline.

  @AC-1 @FR-1 @feature-181
  Scenario: The list renders immediately with per-row readiness loading state
    Given a watchlist with 5 bound (symbol, strategy) rows whose readiness has not yet resolved
    When the trader opens /insights/watchlists and selects that watchlist
    Then all 5 rows are visible with their symbol and strategy immediately
    And each row shows a readiness "loading" indicator until its readiness resolves
    And the list is never blank while readiness is pending

  @AC-2 @FR-1 @FR-5 @feature-181
  Scenario: A readiness failure degrades one row, not the whole list
    Given a watchlist page where readiness for symbol "AMD" fails to resolve
    And readiness for the other rows resolves successfully
    When the page finishes loading
    Then the "AMD" row shows an "unknown"/error readiness state
    And every other row shows its resolved readiness verdict
    And the list itself still rendered (was never blanked or errored as a whole)

  @AC-3 @FR-2 @FR-6 @feature-181
  Scenario: Readiness is decorated inline for the visible page (no client fan-out)
    Given the visible page's bound pairs have warm readiness
    When the UI requests the watchlist page with readiness decoration
    Then each visible row's readiness verdict is decorated inline
    And no per-strategy client-side EvaluateReadiness fan-out is issued for the visible rows

  @AC-4 @FR-3 @feature-181
  Scenario: A long watchlist paginates and only renders the visible page
    Given a watchlist with more bound rows than one page holds and a page size of 25
    When the trader opens the watchlist
    Then only the first 25 rows are rendered and decorated (not all of them)
    And a pagination control advances to the next rows on demand

  @AC-6 @FR-7 @feature-181
  Scenario: New readiness states use the canonical C-17 primitives and are accessible
    Given the watchlist page renders rows whose readiness is still pending
    When a row is in the loading state
    Then the loading state is rendered via the shared C-17 skeleton primitive, not an ad-hoc spinner
    And the loading state is announced to assistive technology (aria-busy or role="status")
    And the pagination control is keyboard-operable and has an accessible label
