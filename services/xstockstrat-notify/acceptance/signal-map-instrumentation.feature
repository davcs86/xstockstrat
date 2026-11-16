# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (notify)

  @AC-31 @FR-10 @feature-294
  Scenario: Notify counts gated deliveries before any channel
    Given an alert with severity INFO below notify.fanout.min_severity 2 and Slack disabled
    When fanout dispatch runs
    Then "notify.delivery" with channel "fanout" and outcome "gated_severity" increases by 1
    And no "notify.delivery" sample has channel "slack"
    And no metric attribute carries the alert category or sourceService

  @AC-32 @FR-10 @feature-294
  Scenario: A failed stream write evicts the subscriber visibly
    Given 3 matching StreamAlerts subscribers and a write to subscriber "sub-2" throws
    When an alert is emitted
    Then "notify.stream.evictions" with reason "write_error" increases by 1
    And gauge "notify.stream.subscribers" reads 2

  # Feature 338: extended by 338 @AC-17 (commsgun listed as enabled or disabled in the same line).
  @AC-49 @FR-10 @feature-294
  Scenario: Notify logs its enabled delivery channels once at startup
    Given notify starts with SLACK_WEBHOOK_URL set, SENDGRID_API_KEY unset and VAPID configured
    When startup completes
    Then exactly 1 INFO "delivery channels" line lists channels "slack,push" as enabled and "sendgrid" as disabled
    And no key or webhook value appears in the line
