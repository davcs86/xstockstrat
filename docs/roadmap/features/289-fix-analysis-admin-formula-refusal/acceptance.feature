Feature: fix-analysis-admin-formula-refusal (bug fix)
  Regression guard for defect report 2026-11-04-analysis-admin-formula-refusal-misclassified-defect: analysis treats indicators' admin-formula refusal as an outage / unhandled error.

  @AC-1 @regression
  Scenario: An admin's view of another user's formula reports a refusal, not a data outage
    Given an admin caller and a live strategy whose formula is owned by another user
    And indicators ExecuteFormula for that formula fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When the admin requests opportunities and EvaluateReadiness for a symbol covered by that strategy
    Then the opportunities row carries a distinct unreadable-formula reason and is not marked data-unavailable
    And EvaluateReadiness returns a per-symbol result for that formula with no ERROR "Unexpected [AioRpcError]" log and no RPC abort
