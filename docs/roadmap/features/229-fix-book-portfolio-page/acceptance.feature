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

  @AC-5 @regression
  Scenario Outline: GetPnL refuses to report unrealized P&L when a needed quote is unavailable
    Given the caller holds "AAPL" and "MSFT" with no broker valuation (current_price 0)
    And <quote_condition>
    When the caller requests GetPnL
    Then the call fails with gRPC status UNAVAILABLE
    And no PnLResponse is returned

    Examples:
      | quote_condition                                            |
      | marketdata GetLatestQuotes never answers                   |
      | marketdata GetLatestQuotes returns a quote for "AAPL" only |

  @AC-6 @regression
  Scenario: GetPnL values broker-synced positions from the broker price without a quote fetch
    Given the caller holds 10 "AAPL" at avg entry 150 with broker current_price 200
    And the caller holds no other positions
    When the caller requests GetPnL
    Then marketdata GetLatestQuotes is not called
    And unrealized_pnl is 500

  @AC-7 @regression
  Scenario Outline: An out-of-window live quote is returned but not cached
    Given marketdata.quotes.latest_lookback_hours is 168
    And "HALT" has no stored quote inside the recency window
    And the live source returns a "HALT" quote timestamped <quote_time>
    When marketdata GetLatestQuotes is called for "HALT"
    Then the "HALT" quote is returned to the caller
    And no row is written to marketdata.quotes

    Examples:
      | quote_time           |
      | 200 hours ago        |
      | 0001-01-01T00:00:00Z |

  @AC-8 @regression
  Scenario Outline: A cold-fetch failure returns the warm subset instead of failing the batch
    Given marketdata.quotes.batch_timeout_ms is 500
    And "AAPL" has a stored quote 2 hours old
    And "MSFT" has no stored quote inside the recency window
    And the live multi-symbol quote fetch for "MSFT" <failure>
    When marketdata GetLatestQuotes is called for "AAPL" and "MSFT"
    Then the call succeeds with the stored "AAPL" quote
    And "MSFT" is omitted from the response, never zero-priced
    And at least one WARN "GetLatestQuotes: cold fetch failed" is logged with the cold symbol count and the error

    Examples:
      | failure                       |
      | returns an error              |
      | does not answer within 500 ms |
