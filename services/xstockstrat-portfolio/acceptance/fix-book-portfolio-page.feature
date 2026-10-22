# Promoted from docs/roadmap/features/229-fix-book-portfolio-page/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-229` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: internal/service/portfolio_quote_deadline_test.go (@AC-1 TestListPositions_AC1_QuoteDeadline,
# TestListPortfolios_AC1_QuoteDeadline; @AC-5 TestGetPnL_AC5_QuotesUnavailable + internal/handler TestClassifyGetPnLError;
# @AC-6 TestGetPnL_AC6_BrokerValuedWithoutQuoteFetch).

Feature: xstockstrat-portfolio — quote-dependent reads are bounded and never fabricate
  Portfolio reads answer within the quote deadline with unenriched positions, and GetPnL refuses a fabricated
  unrealized P&L.

  # Narrowed by feature 240 (C-16, operator sign-off 2026-10-19): when a daily close exists within
  # portfolio.marketdata.last_close_lookback_days an offline position falls back to it (see
  # @AC-27 @feature-240); this scenario now covers the no-bar case. Deadline bound and WARN are kept.
  @AC-1 @regression @feature-229 @feature-240
  Scenario Outline: Portfolio reads return unenriched positions when the quote fetch exceeds its deadline and no daily close exists
    Given an offline account holds "AAPL" and "MSFT" with no broker valuation (current_price 0)
    And no daily bar exists for either symbol within portfolio.marketdata.last_close_lookback_days
    And portfolio.marketdata.quote_timeout_ms is 2500
    And marketdata GetLatestQuotes never answers
    When the caller reads <rpc>
    Then the response returns within 2500 ms + 0.5 s
    And "AAPL" and "MSFT" are returned with current_price 0, mark_source MARK_SOURCE_NONE and no fabricated market value
    And a WARN "batch latest quotes unavailable" is logged with a deadline-exceeded error

    Examples:
      | rpc            |
      | ListPositions  |
      | ListPortfolios |

  @AC-5 @regression @feature-229
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

  @AC-6 @regression @feature-229
  Scenario: GetPnL values broker-synced positions from the broker price without a quote fetch
    Given the caller holds 10 "AAPL" at avg entry 150 with broker current_price 200
    And the caller holds no other positions
    When the caller requests GetPnL
    Then marketdata GetLatestQuotes is not called
    And unrealized_pnl is 500
