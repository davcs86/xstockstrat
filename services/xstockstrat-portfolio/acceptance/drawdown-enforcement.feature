# Promoted from docs/roadmap/features/172-fix-portfolio-max-drawdown-unenforced/acceptance.feature at
# integration (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-172` tag. Durable business rule: portfolio.risk.max_drawdown_pct is enforced per-account
# over broker-authoritative equity against a persisted peak-equity high-water-mark.

Feature: xstockstrat-portfolio — per-account drawdown enforcement
  What xstockstrat-portfolio guarantees for the max-drawdown risk limit: it is no longer
  read-then-discarded — a WARNING alert fires per account whose peak-to-current drawdown (over broker
  account_balances.equity vs a persisted peak_equity high-water-mark) exceeds the configured pct.
  Scoped to trading-loss drawdown (the platform models no deposits/withdrawals — an accepted limitation).

  @AC-1 @FR-1 @regression @feature-172
  Scenario: An account whose equity falls below its peak by more than the configured pct alerts
    Given portfolio.risk.max_drawdown_pct is configured to 0.02
    And an account whose peak_equity high-water-mark is 100 and whose current equity is 97 (a 3% trading-loss drawdown)
    When the risk check runs on an order fill for that account's owner and trading mode
    Then a WARNING portfolio.risk drawdown-breach alert is emitted naming that account
    And an account still within 2% of its peak produces no alert
    And an account with no peak history (peak_equity = 0) produces no alert and no divide-by-zero

  @AC-2 @FR-1 @regression @feature-172
  Scenario: The peak-equity high-water-mark rises with each balance sync and never falls
    Given an account whose stored peak_equity is 100
    When a balance sync reports equity 120
    Then the stored peak_equity becomes 120
    And when a later balance sync reports equity 90 the stored peak_equity remains 120
