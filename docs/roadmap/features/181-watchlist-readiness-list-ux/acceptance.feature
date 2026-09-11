Feature: watchlist-readiness-list-ux
  As a trader opening the watchlist/stock-list page, I want the list to render immediately with a
  per-row readiness loading state and to be paginated, so that a long watchlist is usable right away
  instead of staying blank until every per-symbol readiness promise resolves.

  @AC-1 @FR-1
  Scenario: The list renders immediately with per-row readiness loading state
    Given a watchlist with 5 bound (symbol, strategy) rows whose readiness has not yet resolved
    When the trader opens /insights/watchlists and selects that watchlist
    Then all 5 rows are visible with their symbol and strategy immediately
    And each row shows a readiness "loading" indicator until its readiness resolves
    And the list is never blank while readiness is pending

  @AC-2 @FR-1 @FR-5
  Scenario: A readiness failure degrades one row, not the whole list
    Given a watchlist page where readiness for symbol "AMD" fails to resolve
    And readiness for the other rows resolves successfully
    When the page finishes loading
    Then the "AMD" row shows an "unknown"/error readiness state
    And every other row shows its resolved readiness verdict
    And the list itself still rendered (was never blanked or errored as a whole)

  @AC-3 @FR-2 @FR-6
  Scenario: Readiness is decorated inline for the visible page (warm cache)
    Given feature 180's materializer has warmed readiness for the visible page's bound pairs
    When the UI requests the watchlist page with readiness decoration enabled
    Then the response carries each visible row's readiness verdict inline
    And no per-strategy client-side EvaluateReadiness fan-out is issued for the visible rows
    And the warmed pairs are served from the FAST cache path (no re-fetch or re-evaluation)

  @AC-4 @FR-3
  Scenario: A long watchlist paginates and only evaluates the visible page
    Given a watchlist with 120 bound rows and a page size of 25
    When the trader opens the watchlist
    Then only the first 25 rows are rendered
    And readiness is evaluated/decorated for at most those 25 rows, not all 120
    And a pagination control advances to the next 25 rows on demand

  @AC-5 @FR-4
  Scenario: The decoration introduces no analysis-to-portfolio dependency cycle
    Given analysis already depends on portfolio for watchlist reads
    When readiness decoration is added to the list read path
    Then the xstockstrat-portfolio service declares no AnalysisService client/stub and issues no outbound call to analysis
    And the root CLAUDE.md Inter-Service Dependencies graph gains no portfolio->analysis edge (stays acyclic)

  @AC-6 @FR-7
  Scenario: New readiness states use the canonical C-17 primitives and are accessible
    Given the watchlist page renders rows whose readiness is still pending
    When a row is in the loading state and later resolves
    Then the loading state is rendered via the shared C-17 skeleton/query-state primitive, not an ad-hoc spinner
    And the loading state is announced to assistive technology (aria-busy or role="status")
    And the pagination control is keyboard-operable and has an accessible label
