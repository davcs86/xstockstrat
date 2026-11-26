# Promoted from docs/roadmap/features/315-fix-alert-event-targeting/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-315` tag.
# Durable business rule: per-account risk alerts reach the account owner; only the systemic alert stays untargeted.

Feature: xstockstrat-trading — per-account halt and reconciliation alerts target the account owner
  Regression guard for docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md.

  # guards: docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md
  @AC-1 @regression @feature-315
  Scenario: an automatic account halt alert targets the account owner
    Given trading account "acct-1" whose broker_accounts row has user_id "user-owner"
    And "user-owner" is a non-admin user with a registered push subscription
    When haltAccount halts "acct-1" after a reconciliation mismatch past the grace window
    Then the "halt" CRITICAL EmitAlertRequest has TargetUserId "user-owner"
    And the "reconciliation" CRITICAL EmitAlertRequest from emitReconciliationFinding has TargetUserId "user-owner"
    And the systemic "Systemic broker-reconciliation failure" alert still has an empty TargetUserId
