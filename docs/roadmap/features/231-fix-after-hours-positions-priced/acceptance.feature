Feature: fix-after-hours-positions-priced (bug fix)
  Regression guard for docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md:
  after-hours positions priced at about half value from a one-sided quote.
  Shared givens: LYFT lone side 16.05; stored LYFT 1d close 16.98; mark_close_max_age_hours 168.

  @AC-1 @FR-1 @FR-3 @regression
  Scenario Outline: A one-sided quote values a position at the stored daily close
    Given an offline account holds 10 "LYFT" at a 150.00 cost basis with no broker valuation
    And the latest "LYFT" quote has ask <ask> and bid <bid>
    And the newest stored 1d "LYFT" close is 16.98, stored 24 hours ago
    When the caller reads ListPositions
    Then "LYFT" current_price is 16.98
    And "LYFT" market_value is 169.80
    And "LYFT" unrealized_pnl is 19.80

    Examples:
      | ask   | bid   |
      | 16.05 | 0     |
      | 0     | 16.05 |

  @AC-2 @FR-4 @regression
  Scenario: The persisted equity snapshot values broker positions first and marks the rest
    Given an offline account holds 10 "LYFT" whose mark is 16.98
    And a broker-synced account holds 2 "MSFT" with broker current_price 533.65 and market_value 1067.30
    When the portfolio snapshot is computed
    Then the persisted snapshot equity is 1237.10
    And exactly one "portfolio.snapshot" event and one subscriber update are emitted
    And marketdata GetLatestQuotes is requested for "LYFT" only

  @AC-3 @FR-5 @regression
  Scenario: Concentration sums a symbol across accounts and alerts on the true weights
    Given portfolio.risk.concentration_limit_pct is 0.20
    And offline account "acc-1" holds 10 "LYFT" whose mark is 16.98
    And offline account "acc-2" holds 10 "LYFT" whose mark is 16.98
    And a broker-synced account holds 2 "MSFT" with market_value 1067.30
    When the risk check runs
    Then the emitted concentration alerts are exactly "concentration limit breach: LYFT at 24.1%" and "concentration limit breach: MSFT at 75.9%"

  @AC-4 @FR-6 @regression
  Scenario Outline: The EDGAR fundamentals snapshot is priced from the quote mark
    Given marketdata.fundamentals.snapshot_source is "edgar" and marketdata.edgar.enabled is true
    And "LYFT" has no fresh edgar cache row and its latest filing's filed-date close is 14.20
    And the latest "LYFT" quote has ask <ask> and bid <bid>
    And the newest stored 1d "LYFT" close is 16.98, stored <age> ago
    When marketdata GetFundamentals is called for "LYFT"
    Then the snapshot price is <price>

    Examples:
      | ask   | bid   | age       | price |
      | 16.05 | 0     | 24 hours  | 16.98 |
      | 17.10 | 17.00 | 24 hours  | 17.05 |
      | 16.05 | 0     | 200 hours | 14.20 |

  @AC-5 @FR-1
  Scenario: A two-sided quote's mark is its mid, not the stored close
    Given the latest "LYFT" quote has ask 17.10 and bid 17.00
    And the newest stored 1d "LYFT" close is 16.98, stored 24 hours ago
    When marketdata GetLatestQuotes is called for "LYFT"
    Then the "LYFT" mark_price is 17.05 within 1e-9

  @AC-6 @FR-3 @FR-7
  Scenario: A one-sided quote with no close inside the bound leaves the position unpriced
    Given an offline account holds only 100 "ELWT" with no broker valuation
    And the latest "ELWT" quote has ask 5.60 and bid 0
    And the newest stored 1d "ELWT" close is 5.48, stored 200 hours ago
    When the caller reads ListPositions and then requests GetPnL
    Then "ELWT" current_price is 0
    And GetPnL fails with gRPC status UNAVAILABLE

  @AC-7 @FR-1
  Scenario Outline: The mark comes from a close inside the staleness bound, and raw quote fields are unchanged
    Given marketdata.quotes.mark_close_max_age_hours is 168
    And the latest "LYFT" quote has ask 16.05 and bid 0
    And the stored 1d "LYFT" close state is <close>
    When marketdata GetLatestQuotes is called for "LYFT"
    Then the close lookup is issued with since equal to now minus 168 hours
    And the "LYFT" mark_price is <mark>
    And the "LYFT" ask_price is 16.05 and bid_price is 0

    Examples:
      | close                     | mark  |
      | 16.98 stored 24 hours ago | 16.98 |
      | no 1d close since bound   | unset |

  @AC-8 @FR-4
  Scenario: Any unpriced position skips the equity snapshot and names the symbol
    Given an offline account holds 10 "LYFT" whose mark is 16.98
    And the same account holds 100 "ELWT" with no mark and no two-sided quote
    When the portfolio snapshot is computed
    Then no snapshot row is persisted, no "portfolio.snapshot" event is emitted, and no subscriber update is sent
    And a WARN "portfolio snapshot skipped: positions unpriced" names "ELWT"

  @AC-9 @FR-5
  Scenario: Any unpriced position skips concentration but drawdown still alerts
    Given the holdings of AC-8
    And portfolio.risk.concentration_limit_pct is 0.20 and portfolio.risk.max_drawdown_pct is 0.10
    And account "acc-1" has peak equity 1000.00 and current equity 800.00
    When the risk check runs
    Then no concentration alert is emitted
    And a WARN "concentration check skipped: positions unpriced" names "ELWT"
    And the only alert is "drawdown limit breach: account acc-1 at 20.0% (peak 1000.00, current 800.00)"

  @AC-10 @FR-6
  Scenario: EDGAR multi-symbol fundamentals price pending symbols with one quote call
    Given marketdata.fundamentals.snapshot_source is "edgar"
    And "LYFT" and "MSFT" both need derivation (no fresh edgar cache row)
    When marketdata GetFundamentalsMulti is called for "LYFT" and "MSFT"
    Then exactly one GetLatestQuotes call is made, for "LYFT" and "MSFT"
    And the "LYFT" snapshot price equals the price returned by GetFundamentals for "LYFT"

  @AC-11 @FR-2
  Scenario: A failed close lookup keeps two-sided marks and leaves one-sided marks unset
    Given the close lookup does not answer within marketdata.quotes.mark_timeout_ms
    And the latest "LYFT" quote has ask 16.05 and bid 0
    And the latest "MSFT" quote has ask 534.00 and bid 533.30
    When marketdata GetLatestQuotes is called for "LYFT" and "MSFT"
    Then the "MSFT" mark_price is 533.65 within 1e-9
    And the "LYFT" mark_price is unset
    And a WARN "GetLatestQuotes: mark lookup failed" is logged

  @AC-12 @FR-2
  Scenario Outline: The close lookup runs concurrently with the cold fetch and is bounded by its budget
    Given <condition>
    When marketdata GetLatestQuotes is called for a cold one-sided symbol
    Then <outcome>

    Examples:
      | condition                                                                       | outcome                                                    |
      | the cold fetch blocks until the close lookup has started                        | the call returns with both results within the 5 s guard    |
      | marketdata.quotes.mark_timeout_ms is 100 and the close lookup never answers      | the call returns the cold quote in under 1 second          |

  @AC-13 @FR-3
  Scenario: Every portfolio read path values the one-sided position identically
    Given the position of AC-1 with ask 16.05 and bid 0
    When the caller reads ListPositions, ListPortfolios and GetPnL
    Then all three value "LYFT" at 16.98
    And GetPnL unrealized_pnl is 19.80
    And the ListPortfolios account equity is 169.80

  @AC-14 @FR-3
  Scenario Outline: Without a mark (deploy skew) portfolio falls back to the two-sided mid only
    Given an offline account holds 10 "LYFT" with no broker valuation
    And marketdata returns a "LYFT" quote with no mark_price, ask <ask> and bid <bid>
    When the caller reads ListPositions
    Then "LYFT" current_price is <price>

    Examples:
      | ask   | bid   | price |
      | 17.10 | 17.00 | 17.05 |
      | 16.05 | 0     | 0     |
