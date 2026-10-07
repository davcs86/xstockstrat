# Promoted from docs/roadmap/features/187-opportunities-pagination-drain/acceptance.feature at
# archive time (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-187` tag. Durable business rules xstockstrat-ui guarantees for the Opportunities queue:
# manual Load More progressive retrieval, poll-refetch of all loaded pages, a single-page small queue,
# CopilotRail sharing the shared hook's cache, and no headline stat grid. A rule enters only by
# promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: opportunities-pagination-drain (UI guarantees)
  What the xstockstrat-ui Opportunities queue guarantees: every materialized row is reachable through
  manual Load More, the loaded pages stay fresh on the poll interval, and the page and CopilotRail
  read one shared query.

  @AC-2 @FR-2 @FR-5 @feature-187
  Scenario: UI hook exposes Load More for manual progressive retrieval
    Given 75 materialized opportunities exist for the current user
    When the useOpportunities hook fetches the first page
    Then the hook issues exactly 1 request (page of 50)
    And hasNextPage is true
    When the user triggers Load More
    Then the hook issues a second request for the next page
    And the returned opportunities array contains all 75 rows
    And the rows are in server-side symbol-grouped rank order

  @AC-3 @FR-5 @feature-187
  Scenario: UI poll interval refetches all loaded pages
    Given the useOpportunities hook has loaded 2 pages via Load More
    When the 15-second refetch interval fires
    Then the hook re-fetches both loaded pages from the server
    And the returned result reflects the latest server state

  @AC-5 @FR-2 @feature-187
  Scenario: Small queue returns in a single page without Load More
    Given 10 materialized opportunities exist for the current user
    When the useOpportunities hook fetches data
    Then the hook issues exactly 1 request
    And the returned opportunities array contains all 10 rows
    And hasNextPage is false

  @AC-7 @FR-7 @feature-187
  Scenario: CopilotRail uses shared hook instead of direct RPC
    Given the CopilotRail component is rendered
    When it reads opportunities data
    Then it uses the useOpportunities(0) hook
    And it shares the React Query cache with the opportunities page

  @AC-8 @FR-8 @feature-187
  Scenario: Headline stat grid is removed from the opportunities page
    Given the opportunities page is rendered
    Then there is no headline stat grid displaying "Actionable now", "Expiring < 90m",
      "Exit / Trim flags", "Fresh entries", or "Deployable" tiles
