Feature: fix-push-untargeted-broadcast (bug fix)
  Regression guard for docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md:
  an untargeted alert sends a Web Push to every user's devices.
  Shared givens: VAPID keys configured; notify.push.min_severity 2; "user-42" has 2 push subscriptions
  ("https://push.example/one", "https://push.example/two"); "user-77" has 1 ("https://push.example/three").

  @AC-1 @FR-1 @regression
  Scenario: An untargeted alert is not Web-Pushed to any user's devices
    When EmitAlert is called with an empty target_user_id, severity ALERT_SEVERITY_WARNING, title "portfolio risk limit breach", body "concentration limit breach: LYFT at 24.1%"
    Then no Web Push is sent to "https://push.example/one", "https://push.example/two" or "https://push.example/three"
    And EmitAlert returns an alert_id
    And in-process StreamAlerts subscribers still receive the alert

  @AC-2 @FR-2 @regression
  Scenario: A targeted alert reaches only the target user's devices
    When EmitAlert is called with target_user_id "user-42", severity ALERT_SEVERITY_WARNING, title "Order filled", body "AAPL 10 @ 190.00"
    Then a Web Push with title "Order filled" is sent to exactly "https://push.example/one" and "https://push.example/two"
    And no Web Push is sent to "https://push.example/three"

  @AC-3 @FR-3 @regression
  Scenario: A portfolio risk breach alert is targeted at the account owner
    Given portfolio.risk.concentration_limit_pct is 0.20
    And "user-42" holds a position whose weight is 24.1% of their portfolio in "LYFT"
    When the portfolio risk check runs for "user-42"
    Then notify EmitAlert receives category "risk", severity ALERT_SEVERITY_WARNING and target_user_id "user-42"

  @AC-4 @FR-3 @regression
  Scenario: A live-loop strategy trigger alert is targeted at the strategy owner
    Given "user-42" owns live strategy "strat-1" that triggers "entry" on "AAPL"
    When the analysis live loop emits the strategy trigger alert
    Then notify EmitAlert receives category "strategy", severity ALERT_SEVERITY_WARNING and target_user_id "user-42"
