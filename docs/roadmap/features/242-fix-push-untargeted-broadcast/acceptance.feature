Feature: fix-push-untargeted-broadcast (bug fix)
  Regression guard for docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md:
  an untargeted alert sends a Web Push to every user's devices.

  @AC-1 @FR-1 @regression
  Scenario: An untargeted alert is not Web-Pushed to any non-admin user's devices
    Given VAPID keys are configured and notify.push.min_severity is 2
    And "user-42" does not hold the admin role and has push subscriptions "https://push.example/one" and "https://push.example/two"
    And "user-77" does not hold the admin role and has push subscription "https://push.example/three"
    And "user-99" holds the admin role and has push subscription "https://push.example/admin"
    When EmitAlert is called with an empty target_user_id, severity ALERT_SEVERITY_WARNING, title "portfolio risk limit breach", body "concentration limit breach: LYFT at 24.1%"
    Then no Web Push is sent to "https://push.example/one", "https://push.example/two" or "https://push.example/three"
    And EmitAlert returns an alert_id
    And in-process StreamAlerts subscribers still receive the alert

  @AC-2 @FR-2 @regression
  Scenario: A targeted alert reaches only the target user's devices
    Given VAPID keys are configured and notify.push.min_severity is 2
    And "user-42" does not hold the admin role and has push subscriptions "https://push.example/one" and "https://push.example/two"
    And "user-77" does not hold the admin role and has push subscription "https://push.example/three"
    And "user-99" holds the admin role and has push subscription "https://push.example/admin"
    When EmitAlert is called with target_user_id "user-42", severity ALERT_SEVERITY_WARNING, title "Order filled", body "AAPL 10 @ 190.00"
    Then a Web Push with title "Order filled" is sent to exactly "https://push.example/one" and "https://push.example/two"
    And no Web Push is sent to "https://push.example/three" or "https://push.example/admin"

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

  @AC-5 @FR-1 @regression
  Scenario: An untargeted alert is Web-Pushed only to admin-role users' devices
    Given VAPID keys are configured and notify.push.min_severity is 2
    And "user-42" does not hold the admin role and has push subscriptions "https://push.example/one" and "https://push.example/two"
    And "user-77" does not hold the admin role and has push subscription "https://push.example/three"
    And "user-99" holds the admin role and has push subscription "https://push.example/admin"
    When EmitAlert is called with an empty target_user_id, severity ALERT_SEVERITY_WARNING, title "portfolio risk limit breach", body "concentration limit breach: LYFT at 24.1%"
    Then a Web Push with title "portfolio risk limit breach" is sent to exactly "https://push.example/admin"

  @AC-6 @FR-3 @regression
  Scenario: A portfolio drawdown breach alert is targeted at the account owner
    Given portfolio.risk.max_drawdown_pct is 0.10
    And "user-42" account "acct-1" has peak equity 10000.00 and current equity 8500.00
    When the portfolio risk check runs for "user-42"
    Then notify EmitAlert receives category "risk", severity ALERT_SEVERITY_WARNING, body "drawdown limit breach: account acct-1 at 15.0% (peak 10000.00, current 8500.00)" and target_user_id "user-42"

  @AC-7 @FR-3 @regression
  Scenario: A live-loop fundamentals-unavailable alert is targeted at the strategy owner
    Given analysis.backtest.fundamentals.enabled is true
    And "user-42" owns live strategy "strat-2" that requires fundamentals
    And "MSFT" has no usable fundamentals
    When the analysis live loop denies entry for "strat-2" on "MSFT"
    Then notify EmitAlert receives category "strategy", severity ALERT_SEVERITY_WARNING, title "Strategy strat-2: fundamentals unavailable for MSFT" and target_user_id "user-42"

  @AC-8 @FR-1 @FR-4 @regression
  Scenario: A demoted or deactivated admin stops receiving untargeted pushes on the next alert
    Given VAPID keys are configured and notify.push.min_severity is 2
    And "user-99" holds the admin role and has push subscription "https://push.example/admin"
    And an untargeted ALERT_SEVERITY_WARNING alert has been Web-Pushed to "https://push.example/admin"
    When "user-99" has the admin role removed or is deactivated
    And EmitAlert is called with an empty target_user_id and severity ALERT_SEVERITY_WARNING
    Then no Web Push is sent to "https://push.example/admin"

  @AC-9 @FR-4
  Scenario: ListAdminUserIds returns active admin user IDs only to the notify peer
    Given identity users "user-99" (admin, active), "user-98" (admin, inactive) and "user-42" (not admin, active)
    When a caller whose mTLS peer certificate SAN is "xstockstrat-notify" calls ListAdminUserIds
    Then the response user_ids are exactly ["user-99"]
    And the response carries no field other than user_ids

  @AC-10 @FR-4
  Scenario Outline: ListAdminUserIds denies every non-notify peer before touching identity.users
    Given a caller whose mTLS peer SAN is <peer> and whose metadata carries x-access-scope "4" and x-user-id "system"
    When it calls ListAdminUserIds
    Then identity returns PERMISSION_DENIED
    And no query is issued against identity.users

    Examples:
      | peer                        |
      | "xstockstrat-ui"            |
      | "xstockstrat-notify.evil"   |
      | "xstockstrat-notifyx"       |
      | absent                      |

  @AC-11 @FR-1 @FR-4 @regression
  Scenario: An identity lookup failure never fails or delays EmitAlert and sends no untargeted push
    Given VAPID keys are configured and notify.push.min_severity is 2
    And identity ListAdminUserIds fails with UNAVAILABLE
    When EmitAlert is called with an empty target_user_id and severity ALERT_SEVERITY_WARNING
    Then EmitAlert returns an alert_id
    And no Web Push is sent to any subscription
    And notify logs one ERROR for the admin lookup failure within a 60-second window
