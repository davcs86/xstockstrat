Feature: fix-book-portfolio-page (bug fix)
  Regression guard for docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.md:
  Book → Portfolio page stuck on "Loading portfolio…".

  @AC-1 @regression
  Scenario: Portfolio reads return unenriched positions when the quote fetch exceeds its deadline
    Given a caller holds positions with no broker valuation in an offline account
    And marketdata GetLatestQuotes does not answer within the portfolio quote deadline
    When the caller reads ListPortfolios or ListPositions
    Then the response returns within the deadline plus the portfolio's own DB time
    And those positions carry no enriched price rather than a fabricated one

  @AC-2 @regression
  Scenario: The batch latest-quote read is bounded to a recency window
    Given marketdata.quotes holds quote rows older than the latest-quote recency window
    When marketdata GetLatestQuotes is called for a set of symbols
    Then its cached read considers only rows inside the recency window
    And a symbol whose only quotes are older than the window is treated as cold, not served stale

  @AC-3 @regression
  Scenario: Coalesced quote waiters are not failed by the first caller's cancellation
    Given two concurrent GetLatestQuotes calls share one cold-symbol upstream fetch
    When the first caller cancels its request
    Then the second caller still receives the fetched quotes

  @AC-4 @regression
  Scenario: Quote history is pruned by a retention policy
    Given the marketdata migrations are applied
    Then marketdata.quotes has a retention policy that drops chunks older than the configured retention
