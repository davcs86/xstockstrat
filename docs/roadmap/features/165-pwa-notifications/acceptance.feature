Feature: pwa-notifications
  As a trader who has installed the xstockstrat app, I want to receive push notifications for my
  alerts even when the app is closed, so that I don't miss time-sensitive fills, risk events, and
  opportunities.

  @AC-1 @FR-1
  Scenario: The app is installable and serves a standalone manifest
    Given the xstockstrat-ui is running
    When a browser requests "/manifest.webmanifest"
    Then a valid web app manifest is returned with "display" equal to "standalone"
    And it declares icons at 192x192 and 512x512 including a "maskable" purpose icon
    And the service worker registered at the domain root controls all four segment scopes ("/trader", "/insights", "/config-ui", "/accounts")

  @AC-2 @FR-2
  Scenario: Enabling notifications persists a per-user subscription
    Given a signed-in user "user-42" who has granted Notification permission
    When the app subscribes to push with the VAPID public key and posts the subscription to the BFF
    Then xstockstrat-notify stores a push_subscriptions row for "user-42" with the subscription endpoint, p256dh, and auth keys
    And a second enable from the same browser endpoint upserts (does not duplicate) that row

  @AC-3 @FR-2
  Scenario: Disabling notifications removes the subscription
    Given "user-42" has one stored push subscription with endpoint "https://push.example/abc"
    When the user disables notifications and the app calls UnregisterPushSubscription for that endpoint
    Then the push_subscriptions row for endpoint "https://push.example/abc" no longer exists

  @AC-4 @FR-3
  Scenario: An emitted alert is pushed to the target user's devices
    Given "user-42" has 2 stored push subscriptions and VAPID keys are configured
    When EmitAlert is called with target_user_id "user-42", severity ALERT_SEVERITY_WARNING, title "Order filled", body "AAPL 10 @ 190.00"
    Then a Web Push carrying title "Order filled" and body "AAPL 10 @ 190.00" is sent to both of "user-42"'s subscription endpoints
    And the EmitAlertResponse still returns its alert_id without waiting on push delivery

  @AC-5 @FR-3
  Scenario: Push dispatch never fails or delays the primary emit
    Given the VAPID configuration is invalid or the push service is unreachable
    When EmitAlert is called with target_user_id "user-42" and severity ALERT_SEVERITY_ERROR
    Then EmitAlert returns success with an alert_id and the in-process StreamAlerts subscribers still receive the alert
    And the push failure is caught and logged at WARN, not surfaced as an RPC error

  @AC-6 @FR-5
  Scenario: Push is disabled when VAPID keys are absent
    Given VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY are unset
    When EmitAlert is called with target_user_id "user-42" and severity ALERT_SEVERITY_CRITICAL
    Then no Web Push is attempted and EmitAlert still succeeds with in-process delivery unchanged

  @AC-7 @FR-5
  Scenario: The min-severity gate suppresses low-severity pushes
    Given notify.push.min_severity is 2 and VAPID keys are configured
    When EmitAlert is called with target_user_id "user-42" and severity ALERT_SEVERITY_INFO
    Then no Web Push is sent for that INFO alert
    And a subsequent EmitAlert with severity ALERT_SEVERITY_WARNING does send a Web Push

  @AC-8 @FR-6
  Scenario: A Gone subscription is pruned
    Given "user-42" has a stored subscription whose endpoint returns HTTP 410 Gone on send
    When EmitAlert triggers a push to that endpoint
    Then that push_subscriptions row is deleted and is not retried on the next alert

  @AC-9 @FR-4
  Scenario: Clicking a push notification opens the app
    Given the installed service worker receives a push payload with a "url" of "/trader/positions/AAPL"
    When the service worker's notification is clicked
    Then an existing app window is focused if one is open, otherwise the app opens at "/trader/positions/AAPL"
