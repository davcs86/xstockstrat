Feature: opportunities-pagination-drain
  As a trader with a large watchlist, I want the Opportunities queue to surface ALL materialized
  rows regardless of count, so that every curated symbol appears in my queue and I don't miss
  trading opportunities.

  @AC-1 @FR-1
  Scenario: Server default page size is 50
    Given the ListOpportunities RPC is called with no page_size specified
    When the server applies the default page size
    Then the response contains at most 50 opportunities per page
    And next_page_token is non-empty when more than 50 rows exist

  @AC-2 @FR-2 @FR-5
  Scenario: UI hook exposes Load More for manual progressive retrieval
    Given 75 materialized opportunities exist for the current user
    When the useOpportunities hook fetches the first page
    Then the hook issues exactly 1 request (page of 50)
    And hasNextPage is true
    When the user triggers Load More
    Then the hook issues a second request for the next page
    And the returned opportunities array contains all 75 rows
    And the rows are in server-side symbol-grouped rank order

  @AC-3 @FR-5
  Scenario: UI poll interval refetches all loaded pages
    Given the useOpportunities hook has loaded 2 pages via Load More
    When the 15-second refetch interval fires
    Then the hook re-fetches both loaded pages from the server
    And the returned result reflects the latest server state

  @AC-4 @FR-3
  Scenario: Agent tool exposes pagination params for manual paging
    Given 60 materialized opportunities exist for the user
    When the list_opportunities MCP tool is invoked with default params
    Then the tool returns up to 50 opportunities in rank order
    And the response includes next_page_token for the remaining rows
    When the tool is invoked again with the returned page_token
    Then the remaining 10 opportunities are returned
    And next_page_token is empty

  @AC-5 @FR-2
  Scenario: Small queue returns in a single page without Load More
    Given 10 materialized opportunities exist for the current user
    When the useOpportunities hook fetches data
    Then the hook issues exactly 1 request
    And the returned opportunities array contains all 10 rows
    And hasNextPage is false

  @AC-6 @FR-6
  Scenario: Server-side symbol grouping keeps symbol rows contiguous across pages
    Given 60 materialized opportunities exist across 20 symbols
    When the ListOpportunities RPC returns page 1
    Then each symbol's opportunities are contiguous within the page
    And the symbol groups are ordered by their highest-ranked member descending
    And tied symbol groups are ordered alphabetically by symbol
    And no symbol is split across the page boundary

  @AC-7 @FR-7
  Scenario: CopilotRail uses shared hook instead of direct RPC
    Given the CopilotRail component is rendered
    When it reads opportunities data
    Then it uses the useOpportunities(0) hook
    And it shares the React Query cache with the opportunities page

  @AC-8 @FR-8
  Scenario: Headline stat grid is removed from the opportunities page
    Given the opportunities page is rendered
    Then there is no headline stat grid displaying "Actionable now", "Expiring < 90m",
      "Exit / Trim flags", "Fresh entries", or "Deployable" tiles
