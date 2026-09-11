# Promoted from docs/roadmap/features/165-pwa-notifications/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-165` tag.
# Durable business rules the notify service already guarantees — do not hand-edit to document new
# behavior; a rule enters only by promotion from a reviewed feature acceptance.feature.

Feature: Web Push fanout and push-subscription lifecycle from xstockstrat-notify
  What the notify service guarantees for storing per-user push subscriptions, dispatching Web Push as
  a best-effort side-channel off EmitAlert (never blocking the primary stream), VAPID/severity gating,
  and pruning dead subscriptions.

  @AC-2 @FR-2 @feature-165
  Scenario: Enabling notifications persists a per-user subscription
    Given a signed-in user "user-42" who has granted Notification permission
    When the app subscribes to push with the VAPID public key and posts the subscription to the BFF
    Then xstockstrat-notify stores a push_subscriptions row for "user-42" with the subscription endpoint, p256dh, and auth keys
    And a second enable from the same browser endpoint upserts (does not duplicate) that row

  @AC-3 @FR-2 @feature-165
  Scenario: Disabling notifications removes the subscription
    Given "user-42" has one stored push subscription with endpoint "https://push.example/abc"
    When the user disables notifications and the app calls UnregisterPushSubscription for that endpoint
    Then the push_subscriptions row for endpoint "https://push.example/abc" no longer exists

  @AC-4 @FR-3 @feature-165
  Scenario: An emitted alert is pushed to the target user's devices
    Given "user-42" has 2 stored push subscriptions and VAPID keys are configured
    When EmitAlert is called with target_user_id "user-42", severity ALERT_SEVERITY_WARNING, title "Order filled", body "AAPL 10 @ 190.00"
    Then a Web Push carrying title "Order filled" and body "AAPL 10 @ 190.00" is sent to both of "user-42"'s subscription endpoints
    And the EmitAlertResponse still returns its alert_id without waiting on push delivery

  @AC-5 @FR-3 @feature-165
  Scenario: Push dispatch never fails or delays the primary emit
    Given the VAPID configuration is invalid or the push service is unreachable
    When EmitAlert is called with target_user_id "user-42" and severity ALERT_SEVERITY_ERROR
    Then EmitAlert returns success with an alert_id and the in-process StreamAlerts subscribers still receive the alert
    And the push failure is caught and logged at WARN, not surfaced as an RPC error

  @AC-6 @FR-5 @feature-165
  Scenario: Push is disabled when VAPID keys are absent
    Given VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY are unset
    When EmitAlert is called with target_user_id "user-42" and severity ALERT_SEVERITY_CRITICAL
    Then no Web Push is attempted and EmitAlert still succeeds with in-process delivery unchanged

  @AC-7 @FR-5 @feature-165
  Scenario: The min-severity gate suppresses low-severity pushes
    Given notify.push.min_severity is 2 and VAPID keys are configured
    When EmitAlert is called with target_user_id "user-42" and severity ALERT_SEVERITY_INFO
    Then no Web Push is sent for that INFO alert
    And a subsequent EmitAlert with severity ALERT_SEVERITY_WARNING does send a Web Push

  @AC-8 @FR-6 @feature-165
  Scenario: A Gone subscription is pruned
    Given "user-42" has a stored subscription whose endpoint returns HTTP 410 Gone on send
    When EmitAlert triggers a push to that endpoint
    Then that push_subscriptions row is deleted and is not retried on the next alert
