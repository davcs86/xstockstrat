Feature: fix-deploy-wait-loop (bug fix)
  Regression guard for defect docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md (pruned 2026-11-04; git show 9892b610:docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md):
  the DO deploy wait loop must not spin to its timeout on a superseded deployment.

  @AC-1 @regression
  Scenario: A superseded deployment ends the wait loop immediately instead of timing out
    Given the deployment being waited on reports phase SUPERSEDED
    When the "Wait for deployment" step polls it
    Then the step exits on that poll, well before the 60-iteration timeout, and does not print the timeout message

  @AC-2 @regression
  Scenario: Two quick pushes to main-dev deploy the same app one at a time
    Given two pushes to main-dev land within a minute
    When both "Deploy dev" runs reach the deploy job
    Then the second run's deploy job waits for the first to finish before it starts, and neither run is red
