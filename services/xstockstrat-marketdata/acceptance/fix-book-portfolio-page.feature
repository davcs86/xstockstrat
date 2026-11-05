# Promoted from docs/roadmap/features/229-fix-book-portfolio-page/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-229` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: internal/service/marketdata_service_test.go (@AC-2 TestGetLatestQuotes_AC2_WindowedWarmRead,
# @AC-3 _AC3_DetachedFromFirstCallerCancel, @AC-7 _AC7_OldLiveQuoteNotCached, @AC-8 _AC8_PartialOnColdFailure,
# @AC-4 TestRunQuoteRetentionStep) and internal/repository/marketdata_repo_test.go (SQL shape; live proof = staging G1–G3).

Feature: xstockstrat-marketdata — bounded quote reads, detached cold fetch and quote retention
  Cached quote reads are bounded to a recency window, a cold fetch is budgeted and never fails coalesced callers,
  and quote history is pruned by retention.

  @AC-2 @regression @feature-229
  Scenario: The cached batch latest-quote read ignores rows outside the recency window
    Given marketdata.quotes.latest_lookback_hours is 168
    And "AAPL" has a stored quote 2 hours old
    And "MSFT" has only a stored quote 200 hours old
    When marketdata GetLatestQuotes is called for "AAPL" and "MSFT"
    Then "AAPL" is served from the cache without a live fetch
    And "MSFT" is treated as cold and requested from the live source

  @AC-3 @regression @feature-229
  Scenario: Coalesced quote waiters are not failed by the first caller's cancellation
    Given "AAPL" and "MSFT" are cold
    And two concurrent GetLatestQuotes calls for them share one upstream fetch
    When the first caller cancels its request before the fetch returns
    Then the second caller still receives quotes for "AAPL" and "MSFT"

  @AC-4 @regression @feature-229
  Scenario: Quote history older than the retention period is pruned
    Given marketdata.retention.quotes_days is 90
    And marketdata.quotes holds a chunk entirely older than 91 days and a chunk from today
    When the quote retention job runs
    Then the 91-day-old chunk is dropped
    And today's chunk remains

  @AC-7 @regression @feature-229
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

  @AC-8 @regression @feature-229
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
