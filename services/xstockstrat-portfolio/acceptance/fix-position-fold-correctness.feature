# Promoted from docs/roadmap/features/311-fix-position-fold-correctness/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-311` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. These cover the live position
# fold applying each order.filled fill exactly once and with the correct sign.

Feature: xstockstrat-portfolio — the live position fold applies each fill exactly once, with the correct sign
  Regression guard for clustered defect reports: the portfolio live position fold applies each fill
  exactly once, with the correct sign, including bracket-leg exits.

  # guards: docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md
  @AC-1 @regression @feature-311
  Scenario: A portfolio restart does not re-apply already-folded fills
    Given a broker-account position for "AAPL" with qty 10, cost_basis 1000 and realized_accum 250
    And no account.positions.synced event arrives
    When xstockstrat-portfolio restarts and its order.filled consumer resumes
    Then the "AAPL" row still has qty 10, cost_basis 1000 and realized_accum 250

  # guards: docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md
  @AC-2 @regression @feature-311
  Scenario: Two concurrently running portfolio processes apply one fill once
    Given two xstockstrat-portfolio processes consume the same ledger against the same database
    And a broker-account position for "AAPL" with qty 10
    When one order.filled event for a buy of 5 "AAPL" is appended
    Then the "AAPL" row has qty 15

  # guards: docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md
  @AC-3 @regression @feature-311
  Scenario: A sell fill closes the position and seals realized P&L
    Given a broker account that bought 10 "AAPL" at 100 via order.filled
    When an order.filled event for a sell of 10 "AAPL" at 150 is folded before any positions sync
    Then the "AAPL" position row is closed
    And portfolio.position.closed is emitted with realized_pnl 500
