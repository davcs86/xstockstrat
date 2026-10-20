# Promoted from docs/roadmap/features/231-fix-after-hours-positions-priced/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-231` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-portfolio — one-sided quotes are valued from the mark, never averaged with zero
  Regression guard for docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md:
  after-hours positions priced at about half value from a one-sided quote.
  Shared givens: LYFT lone side 16.05; stored LYFT 1d close 16.98; mark_close_max_age_hours 168.

  @AC-1 @FR-1 @FR-3 @regression @feature-231
  Scenario Outline: A one-sided quote values a position at the stored daily close
    Given an offline account holds 10 "LYFT" at cost_basis 150.00 (avg_entry_price 15.00) with no broker valuation
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

  @AC-2 @FR-4 @regression @feature-231
  Scenario: The persisted equity snapshot values broker positions first and marks the rest
    Given an offline account holds 10 "LYFT" whose mark is 16.98
    And a broker-synced account holds 2 "MSFT" with broker current_price 533.65 and market_value 1067.30
    When the portfolio snapshot is computed
    Then the persisted snapshot equity is 1237.10
    And exactly one "portfolio.snapshot" event and one subscriber update are emitted
    And marketdata GetLatestQuotes is requested for "LYFT" only

  @AC-3 @FR-5 @regression @feature-231
  Scenario: Concentration sums a symbol across accounts and alerts on the true weights
    Given portfolio.risk.concentration_limit_pct is 0.20
    And offline account "acc-1" holds 10 "LYFT" whose mark is 16.98
    And offline account "acc-2" holds 10 "LYFT" whose mark is 16.98
    And a broker-synced account holds 2 "MSFT" with market_value 1067.30
    When the risk check runs
    Then the emitted concentration alerts are exactly "concentration limit breach: LYFT at 24.1%" and "concentration limit breach: MSFT at 75.9%"

  @AC-6 @FR-3 @FR-7 @feature-231
  Scenario: A one-sided quote with no close inside the bound leaves the position unpriced
    Given an offline account holds only 100 "ELWT" with no broker valuation
    And the latest "ELWT" quote has ask 5.60 and bid 0
    And the newest stored 1d "ELWT" close is 5.48, stored 200 hours ago
    When the caller reads ListPositions and then requests GetPnL
    Then "ELWT" current_price is 0
    And GetPnL fails with gRPC status UNAVAILABLE

  @AC-8 @FR-4 @feature-231
  Scenario: Any unpriced position skips the equity snapshot and names the symbol
    Given an offline account holds 10 "LYFT" whose mark is 16.98
    And the same account holds 100 "ELWT" with no mark and no two-sided quote
    When the portfolio snapshot is computed
    Then no snapshot row is persisted, no "portfolio.snapshot" event is emitted, and no subscriber update is sent
    And a WARN "portfolio snapshot skipped: positions unpriced" names "ELWT"

  @AC-9 @FR-5 @feature-231
  Scenario: Any unpriced position skips concentration but drawdown still alerts
    Given an offline account holds 10 "LYFT" whose mark is 16.98
    And the same account holds 100 "ELWT" with no mark and no two-sided quote
    And broker-synced account "brk-1" has account balance peak equity 1000.00 and current equity 800.00
    And portfolio.risk.concentration_limit_pct is 0.20 and portfolio.risk.max_drawdown_pct is 0.10
    When the risk check runs
    Then no concentration alert is emitted
    And a WARN "concentration check skipped: positions unpriced" names "ELWT"
    And the only alert is "drawdown limit breach: account brk-1 at 20.0% (peak 1000.00, current 800.00)"

  @AC-13 @FR-3 @feature-231
  Scenario: Every portfolio read path values the one-sided position identically
    Given the position of AC-1 with ask 16.05 and bid 0
    When the caller reads ListPositions, GetPosition, GetPortfolio, ListPortfolios and GetPnL
    Then all five value "LYFT" at 16.98
    And GetPnL unrealized_pnl is 19.80
    And the ListPortfolios account equity is 169.80

  @AC-14 @FR-3 @feature-231
  Scenario Outline: Without a mark (deploy skew) portfolio falls back to the two-sided mid only
    Given an offline account holds 10 "LYFT" with no broker valuation
    And marketdata returns a "LYFT" quote with no mark_price, ask <ask> and bid <bid>
    When the caller reads ListPositions
    Then "LYFT" current_price is <price>

    Examples:
      | ask   | bid   | price |
      | 17.10 | 17.00 | 17.05 |
      | 16.05 | 0     | 0     |
