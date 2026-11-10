Feature: fix-notify-stream-contract (bug fix)
  Regression guard for clustered defect reports: StreamAlerts severity filtering works with the wire's string
  enums, and a subscriber that stops reading is evicted instead of buffered without bound.

  # guards: docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md
  @AC-1 @regression
  Scenario: a severity-filtered subscriber receives alerts matched by the string enum form
    Given a StreamAlerts subscriber with severities ["ALERT_SEVERITY_WARNING", "ALERT_SEVERITY_CRITICAL"]
    When EmitAlert is called with severity "ALERT_SEVERITY_CRITICAL"
    Then the subscriber receives the alert
    And an alert with severity "ALERT_SEVERITY_INFO" is not delivered to it

  # guards: docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md
  @AC-2 @regression
  Scenario: a subscriber whose stream stops draining is evicted
    Given a StreamAlerts subscriber whose call.write returns false and never emits drain
    When EmitAlert is called repeatedly past the backpressure threshold
    Then the subscriber is removed from the fan-out set or its stream is ended
    And further EmitAlert calls do not write to it
