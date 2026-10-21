Feature: fix-getpnl-source-service (bug fix)
  Regression guard for docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md:
  GetPnL queries ledger fills with source_service "trading", but trading writes "xstockstrat-trading".

  @AC-1 @regression
  Scenario: Realized P&L folds fills that trading wrote to the ledger
    Given a ledger that filters QueryEvents by exact source_service match
    And the ledger holds "order.filled" events with source_service "xstockstrat-trading" for user "u-1": buy 10 "AAPL" @ 100.00, then sell 10 "AAPL" @ 150.00
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00

  @AC-2 @regression
  Scenario: Partially filled orders written by trading are included in realized P&L
    Given a ledger that filters QueryEvents by exact source_service match
    And the ledger holds, with source_service "xstockstrat-trading" for user "u-1", an "order.filled" buy 10 "AAPL" @ 100.00 and an "order.partially_filled" sell "AAPL" with cumulative filled qty 4 @ 150.00 on an order that never fully fills
    When GetPnL runs for user "u-1"
    Then realized_pnl is 200.00
