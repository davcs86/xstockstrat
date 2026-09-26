Feature: alert-read-unread-persistence (notify)
  Promoted from feature 203 (@AC-1..@AC-5). Per-user read/unread state on notify alerts: MarkAlertRead
  is per-user and idempotent, broadcast read state is isolated per user, the unread_only filter and
  unread_count are per caller, and read state is independent of the acknowledged flag.

  @AC-1 @FR-2 @FR-3 @feature-203
  Scenario: Marking a targeted alert read flips it to read for that user
    Given user "u1" has a targeted alert "a1" that is currently unread
    When user "u1" calls MarkAlertRead for "a1"
    Then ListAlerts for user "u1" returns "a1" with read = true and a non-null read_at
    And the unread_count for user "u1" decreases by 1

  @AC-2 @FR-1 @FR-4 @feature-203
  Scenario: A broadcast alert is unread for one user and read for another
    Given a broadcast alert "b1" (target_user_id empty) visible to users "u1" and "u2"
    And user "u1" has called MarkAlertRead for "b1"
    When ListAlerts is called for each user
    Then "b1" is read = true for user "u1"
    And "b1" is read = false for user "u2"

  @AC-3 @FR-2 @feature-203
  Scenario: MarkAlertRead is idempotent
    Given user "u1" has already marked alert "a1" read at "2026-09-24T10:00:00Z"
    When user "u1" calls MarkAlertRead for "a1" again
    Then the call succeeds
    And read_at for "a1" remains "2026-09-24T10:00:00Z"

  @AC-4 @FR-3 @feature-203
  Scenario: unread_only filter returns only the caller's unread alerts
    Given user "u1" has 3 alerts, of which 1 has been marked read
    When ListAlerts is called for "u1" with unread_only = true
    Then exactly 2 alerts are returned
    And every returned alert has read = false

  @AC-5 @FR-1 @feature-203
  Scenario: Read state and acknowledged state are independent
    Given alert "a1" for user "u1" is acknowledged = true and unread
    When user "u1" calls ListAlerts
    Then "a1" is returned with acknowledged = true and read = false
