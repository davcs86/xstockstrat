Feature: fix-opportunities-read-hangs (bug fix)
  Regression guard for docs/reports/2026-10-14-opportunities-read-hangs-defect.md:
  Opportunities read hangs silently past client timeouts.

  @AC-1 @regression
  Scenario: A stalled price enrichment returns the stored rows unenriched within the deadline
    Given a user with stored opportunities "AAPL" and "MSFT"
    And marketdata BatchGetLatestPrice never responds
    When the user calls analysis "ListOpportunities"
    Then the call returns both rows before the enrichment deadline elapses
    And the rows carry no live price
    And a warning naming "BatchGetLatestPrice" is logged

  @AC-2 @regression
  Scenario: A hung analysis read fails fast at the agent instead of hanging
    Given analysis "ListOpportunities" never responds
    When the agent tool "list_opportunities" is called
    Then it returns an error naming a deadline before the MCP client's 60-second limit

  @AC-3 @regression
  Scenario: marketdata logs the vendor error it falls back from
    Given the Alpaca multi-symbol latest-trades call fails with an error
    When marketdata serves "BatchGetLatestPrice" for "AAPL"
    Then the error is logged with the symbol count and the fallback path taken

  @AC-4 @regression
  Scenario: An exhausted analysis DB pool fails the read fast
    Given every analysis DB pool connection is held
    When the user calls analysis "ListOpportunities"
    Then it fails with status "UNAVAILABLE" within the pool-acquire timeout and a warning is logged
