Feature: fix-portfolio-max-drawdown-unenforced (bug fix — enforce, per-account)
  Regression guard for comment-audit report item 2: portfolio.risk.max_drawdown_pct is no longer
  read-then-discarded. Drawdown is enforced PER ACCOUNT over broker-authoritative equity
  (account_balances.equity, cash+positions) against a persisted peak-equity high-water-mark, and a
  WARNING alert fires on breach — reusing the existing risk-alert path. Scoped to a trading-loss
  drawdown (the platform models no deposits/withdrawals; that path is an accepted known limitation,
  not asserted here).

  @AC-1 @FR-1 @regression
  Scenario: An account whose equity falls below its peak by more than the configured pct alerts
    Given portfolio.risk.max_drawdown_pct is configured to 0.02
    And an account whose peak_equity high-water-mark is 100 and whose current equity is 97 (a 3% trading-loss drawdown)
    When the risk check runs on an order fill for that account's owner and trading mode
    Then a WARNING portfolio.risk drawdown-breach alert is emitted naming that account
    And an account still within 2% of its peak produces no alert
    And an account with no peak history (peak_equity = 0) produces no alert and no divide-by-zero

  @AC-2 @FR-1 @regression
  Scenario: The peak-equity high-water-mark rises with each balance sync and never falls
    Given an account whose stored peak_equity is 100
    When a balance sync reports equity 120
    Then the stored peak_equity becomes 120
    And when a later balance sync reports equity 90 the stored peak_equity remains 120
