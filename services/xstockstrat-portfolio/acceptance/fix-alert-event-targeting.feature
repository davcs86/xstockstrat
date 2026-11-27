# Promoted from docs/roadmap/features/315-fix-alert-event-targeting/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-315` tag.
# Durable business rule: risk-breach ledger events are labelled by kind and attributable to a user.

Feature: xstockstrat-portfolio — risk-breach ledger events are labelled by kind and attributable to the owner
  Regression guard for docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md.

  # guards: docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md
  @AC-2 @regression @feature-315
  Scenario: a concentration breach is recorded as a concentration event, not a drawdown
    Given portfolio.risk.concentration_limit_pct is 0.20
    And user "user-1" holds AAPL at 35% of portfolio value with no drawdown breach
    When checkRiskLimits runs for "user-1"
    Then the appended ledger event type is not "portfolio.risk.drawdown_breach"
    And the event payload carries user_id "user-1" and symbol "AAPL"

  # guards: docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md
  @AC-3 @regression @feature-315
  Scenario: a drawdown breach still emits a drawdown event, attributed to the owner and account
    Given portfolio.risk.max_drawdown_pct is 0.10
    And user "user-1" has account "acct-1" with equity 8500.00 and peak equity 10000.00 and no concentration breach
    When checkRiskLimits runs for "user-1"
    Then the appended ledger event type is "portfolio.risk.drawdown_breach"
    And the event is owned by "user-1" and its payload carries user_id "user-1" and account_id "acct-1"
