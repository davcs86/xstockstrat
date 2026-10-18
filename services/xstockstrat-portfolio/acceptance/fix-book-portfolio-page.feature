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

  @AC-1 @regression @feature-229
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
