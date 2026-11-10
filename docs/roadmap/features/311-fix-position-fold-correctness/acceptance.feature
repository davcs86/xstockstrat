Feature: fix-position-fold-correctness (bug fix)
  Regression guard for clustered defect reports: the portfolio live position fold applies each fill
  exactly once, with the correct sign, including bracket-leg exits.

  # guards: docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md
  @AC-1 @regression
  Scenario: A portfolio restart does not re-apply already-folded fills
    Given a broker-account position for "AAPL" with qty 10, cost_basis 1000 and realized_accum 250
    And no account.positions.synced event arrives
    When xstockstrat-portfolio restarts and its order.filled consumer resumes
    Then the "AAPL" row still has qty 10, cost_basis 1000 and realized_accum 250

  # guards: docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md
  @AC-2 @regression
  Scenario: Two concurrently running portfolio processes apply one fill once
    Given two xstockstrat-portfolio processes consume the same ledger against the same database
    And a broker-account position for "AAPL" with qty 10
    When one order.filled event for a buy of 5 "AAPL" is appended
    Then the "AAPL" row has qty 15

  # guards: docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md
  @AC-3 @regression
  Scenario: A sell fill closes the position and seals realized P&L
    Given a broker account that bought 10 "AAPL" at 100 via order.filled
    When an order.filled event for a sell of 10 "AAPL" at 150 is folded before any positions sync
    Then the "AAPL" position row is closed
    And portfolio.position.closed is emitted with realized_pnl 500

  # guards: docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md
  @AC-4 @regression
  Scenario: A bracket take-profit leg fill reaches the ledger and realized P&L
    Given trading.risk.bracket_orders_enabled is true
    And an auto-sized market buy of 10 "AAPL" at 100 with a stop price filled and recorded its legs in trading.order_brackets
    When the take-profit leg fills at the broker for 10 "AAPL" at 110
    Then the ledger holds a fill event for that leg with symbol "AAPL", side sell, qty 10, price 110, and the order's account, trading mode and user
    And GetPnL realized for the round trip is 100
