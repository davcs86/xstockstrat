Feature: alert-read-unread-persistence
  As a platform user, I want my alerts to remember whether I have read them, so that my
  notification inbox shows an accurate unread count and I can mark alerts read — independently of
  whether another user has read the same broadcast alert, and independently of the operational
  acknowledged flag.

  @AC-1 @FR-2 @FR-3
  Scenario: Marking a targeted alert read flips it to read for that user
    Given user "u1" has a targeted alert "a1" that is currently unread
    When user "u1" calls MarkAlertRead for "a1"
    Then ListAlerts for user "u1" returns "a1" with read = true and a non-null read_at
    And the unread_count for user "u1" decreases by 1

  @AC-2 @FR-1 @FR-4
  Scenario: A broadcast alert is unread for one user and read for another
    Given a broadcast alert "b1" (target_user_id empty) visible to users "u1" and "u2"
    And user "u1" has called MarkAlertRead for "b1"
    When ListAlerts is called for each user
    Then "b1" is read = true for user "u1"
    And "b1" is read = false for user "u2"

  @AC-3 @FR-2
  Scenario: MarkAlertRead is idempotent
    Given user "u1" has already marked alert "a1" read at "2026-09-24T10:00:00Z"
    When user "u1" calls MarkAlertRead for "a1" again
    Then the call succeeds
    And read_at for "a1" remains "2026-09-24T10:00:00Z"

  @AC-4 @FR-3
  Scenario: unread_only filter returns only the caller's unread alerts
    Given user "u1" has 3 alerts, of which 1 has been marked read
    When ListAlerts is called for "u1" with unread_only = true
    Then exactly 2 alerts are returned
    And every returned alert has read = false

  @AC-5 @FR-1
  Scenario: Read state and acknowledged state are independent
    Given alert "a1" for user "u1" is acknowledged = true and unread
    When user "u1" calls ListAlerts
    Then "a1" is returned with acknowledged = true and read = false

  @AC-6 @FR-5 @FR-6
  Scenario: The notifications inbox shows level, module, body, and unread state
    Given user "u1" has an unread alert with severity ALERT_SEVERITY_WARNING, category "risk",
      source_service "xstockstrat-portfolio", and body "Drawdown limit approached"
    When user "u1" opens the /accounts/notifications page
    Then the alert row shows the WARNING level, the module "risk" (from category), the body text,
      and an unread indicator
    And an unread count badge is displayed
