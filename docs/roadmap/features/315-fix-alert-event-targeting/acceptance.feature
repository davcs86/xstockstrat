Feature: fix-alert-event-targeting (bug fix)
  Regression guard for clustered defect reports: per-account risk alerts reach the account owner, and risk-breach
  ledger events are labelled by kind and attributable to a user.

  # guards: docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md
  @AC-1 @regression
  Scenario: an automatic account halt alert targets the account owner
    Given trading account "acct-1" whose broker_accounts row has user_id "user-owner"
    And "user-owner" is a non-admin user with a registered push subscription
    When haltAccount halts "acct-1" after a reconciliation mismatch past the grace window
    Then the "halt" CRITICAL EmitAlertRequest has TargetUserId "user-owner"
    And the "reconciliation" CRITICAL EmitAlertRequest from emitReconciliationFinding has TargetUserId "user-owner"
    And the systemic "Systemic broker-reconciliation failure" alert still has an empty TargetUserId

  # guards: docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md
  @AC-2 @regression
  Scenario: a concentration breach is recorded as a concentration event, not a drawdown
    Given portfolio.risk.concentration_limit_pct is 0.20
    And user "user-1" holds AAPL at 35% of portfolio value with no drawdown breach
    When checkRiskLimits runs for "user-1"
    Then the appended ledger event type is not "portfolio.risk.drawdown_breach"
    And the event payload carries user_id "user-1" and symbol "AAPL"
