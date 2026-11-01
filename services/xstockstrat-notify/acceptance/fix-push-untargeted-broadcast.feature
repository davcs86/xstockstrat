# Promoted from docs/roadmap/features/242-fix-push-untargeted-broadcast/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-242` tag.
# Durable business rules notify already guarantees; a rule enters only by promotion from a reviewed acceptance.feature.

Feature: xstockstrat-notify - Web Push recipients for targeted and untargeted alerts
  An untargeted alert is never Web-Pushed to ordinary users' devices; only admin-role users receive it.

  @AC-1 @FR-1 @regression @feature-242
  Scenario: An untargeted alert is not Web-Pushed to any non-admin user's devices
    Given VAPID keys are configured and notify.push.min_severity is 2
    And "user-42" does not hold the admin role and has push subscriptions "https://push.example/one" and "https://push.example/two"
    And "user-77" does not hold the admin role and has push subscription "https://push.example/three"
    And "user-99" holds the admin role and has push subscription "https://push.example/admin"
    When EmitAlert is called with an empty target_user_id, severity ALERT_SEVERITY_WARNING, title "portfolio risk limit breach", body "concentration limit breach: LYFT at 24.1%"
    Then no Web Push is sent to "https://push.example/one", "https://push.example/two" or "https://push.example/three"
    And EmitAlert returns an alert_id
    And in-process StreamAlerts subscribers still receive the alert

  @AC-2 @FR-2 @regression @feature-242
  Scenario: A targeted alert reaches only the target user's devices
    Given VAPID keys are configured and notify.push.min_severity is 2
    And "user-42" does not hold the admin role and has push subscriptions "https://push.example/one" and "https://push.example/two"
    And "user-77" does not hold the admin role and has push subscription "https://push.example/three"
    And "user-99" holds the admin role and has push subscription "https://push.example/admin"
    When EmitAlert is called with target_user_id "user-42", severity ALERT_SEVERITY_WARNING, title "Order filled", body "AAPL 10 @ 190.00"
    Then a Web Push with title "Order filled" is sent to exactly "https://push.example/one" and "https://push.example/two"
    And no Web Push is sent to "https://push.example/three" or "https://push.example/admin"

  @AC-5 @FR-1 @regression @feature-242
  Scenario: An untargeted alert is Web-Pushed only to admin-role users' devices
    Given VAPID keys are configured and notify.push.min_severity is 2
    And "user-42" does not hold the admin role and has push subscriptions "https://push.example/one" and "https://push.example/two"
    And "user-77" does not hold the admin role and has push subscription "https://push.example/three"
    And "user-99" holds the admin role and has push subscription "https://push.example/admin"
    When EmitAlert is called with an empty target_user_id, severity ALERT_SEVERITY_WARNING, title "portfolio risk limit breach", body "concentration limit breach: LYFT at 24.1%"
    Then a Web Push with title "portfolio risk limit breach" is sent to exactly "https://push.example/admin"

  @AC-8 @FR-1 @FR-4 @regression @feature-242
  Scenario: A demoted or deactivated admin stops receiving untargeted pushes on the next alert
    Given VAPID keys are configured and notify.push.min_severity is 2
    And "user-99" holds the admin role and has push subscription "https://push.example/admin"
    And an untargeted ALERT_SEVERITY_WARNING alert has been Web-Pushed to "https://push.example/admin"
    When "user-99" has the admin role removed or is deactivated
    And EmitAlert is called with an empty target_user_id and severity ALERT_SEVERITY_WARNING
    Then no Web Push is sent to "https://push.example/admin"

  @AC-11 @FR-1 @FR-4 @regression @feature-242
  Scenario: An identity lookup failure never fails or delays EmitAlert and sends no untargeted push
    Given VAPID keys are configured and notify.push.min_severity is 2
    And identity ListAdminUserIds fails with UNAVAILABLE
    When EmitAlert is called with an empty target_user_id and severity ALERT_SEVERITY_WARNING
    Then EmitAlert returns an alert_id
    And no Web Push is sent to any subscription
    And notify logs one ERROR for the admin lookup failure within a 60-second window
