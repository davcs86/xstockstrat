Feature: opportunities-pagination-drain
  As a trader with a large watchlist, I want the Opportunities queue to surface ALL materialized
  rows regardless of count, so that every curated symbol appears in my queue and I don't miss
  trading opportunities.

  @AC-1 @FR-1
  Scenario: Server default page size is 25
    Given the ListOpportunities RPC is called with no page_size specified
    When the server applies the default page size
    Then the response contains at most 25 opportunities per page
    And next_page_token is non-empty when more than 25 rows exist

  @AC-2 @FR-2 @FR-4
  Scenario: UI hook drains all pages into a single result
    Given 75 materialized opportunities exist for the current user
    When the useOpportunities hook fetches data
    Then the hook issues 3 sequential requests (pages of 25)
    And the returned opportunities array contains all 75 rows
    And the rows are in descending conviction × signal_axis rank order

  @AC-3 @FR-5
  Scenario: UI poll interval refetches all pages
    Given the useOpportunities hook has previously drained 3 pages
    When the 15-second refetch interval fires
    Then the hook re-drains all pages from page 1
    And the returned result reflects the latest server state

  @AC-4 @FR-3 @FR-4
  Scenario: Agent tool drains all pages
    Given 60 materialized opportunities exist for the user
    When the list_opportunities MCP tool is invoked
    Then the tool returns all 60 opportunities in rank order
    And the response does not expose pagination tokens to the MCP caller

  @AC-5 @FR-2
  Scenario: Small queue returns in a single page without extra requests
    Given 10 materialized opportunities exist for the current user
    When the useOpportunities hook fetches data
    Then the hook issues exactly 1 request
    And the returned opportunities array contains all 10 rows
    And next_page_token in the response is empty
