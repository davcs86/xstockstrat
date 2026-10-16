Feature: fix-book-portfolio-page (bug fix)
  Regression guard for docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.md:
  Book → Portfolio page stuck on "Loading portfolio…".

  @AC-1 @regression
  Scenario Outline: Portfolio reads return unenriched positions when the quote fetch exceeds its deadline
    Given an offline account holds "AAPL" and "MSFT" with no broker valuation (current_price 0)
    And portfolio.marketdata.quote_timeout_ms is 2500
    And marketdata GetLatestQuotes never answers
    When the caller reads <rpc>
    Then the response returns within 2500 ms + 0.5 s
    And "AAPL" and "MSFT" are returned with current_price 0 and no fabricated market value
    And a WARN "batch latest quotes unavailable" is logged with a deadline-exceeded error

    Examples:
      | rpc            |
      | ListPositions  |
      | ListPortfolios |

  @AC-2 @regression
  Scenario: The cached batch latest-quote read ignores rows outside the recency window
    Given marketdata.quotes.latest_lookback_hours is 168
    And "AAPL" has a stored quote 2 hours old
    And "MSFT" has only a stored quote 200 hours old
    When marketdata GetLatestQuotes is called for "AAPL" and "MSFT"
    Then "AAPL" is served from the cache without a live fetch
    And "MSFT" is treated as cold and requested from the live source

  @AC-3 @regression
  Scenario: Coalesced quote waiters are not failed by the first caller's cancellation
    Given "AAPL" and "MSFT" are cold
    And two concurrent GetLatestQuotes calls for them share one upstream fetch
    When the first caller cancels its request before the fetch returns
    Then the second caller still receives quotes for "AAPL" and "MSFT"

  @AC-4 @regression
  Scenario: Quote history older than the retention period is pruned
    Given marketdata.retention.quotes_days is 90
    And marketdata.quotes holds a chunk entirely older than 91 days and a chunk from today
    When the quote retention job runs
    Then the 91-day-old chunk is dropped
    And today's chunk remains
