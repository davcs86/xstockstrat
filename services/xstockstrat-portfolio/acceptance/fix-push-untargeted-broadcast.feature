# Promoted from docs/roadmap/features/242-fix-push-untargeted-broadcast/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-242` tag.

Feature: xstockstrat-portfolio - risk-breach alerts are targeted at the account owner

  @AC-3 @FR-3 @regression @feature-242
  Scenario: A portfolio risk breach alert is targeted at the account owner
    Given portfolio.risk.concentration_limit_pct is 0.20
    And "user-42" holds a position whose weight is 24.1% of their portfolio in "LYFT"
    When the portfolio risk check runs for "user-42"
    Then notify EmitAlert receives category "risk", severity ALERT_SEVERITY_WARNING and target_user_id "user-42"

  @AC-6 @FR-3 @regression @feature-242
  Scenario: A portfolio drawdown breach alert is targeted at the account owner
    Given portfolio.risk.max_drawdown_pct is 0.10
    And "user-42" account "acct-1" has peak equity 10000.00 and current equity 8500.00
    When the portfolio risk check runs for "user-42"
    Then notify EmitAlert receives category "risk", severity ALERT_SEVERITY_WARNING, body "drawdown limit breach: account acct-1 at 15.0% (peak 10000.00, current 8500.00)" and target_user_id "user-42"
