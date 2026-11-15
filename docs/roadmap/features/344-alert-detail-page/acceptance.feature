Feature: alert-detail-page
  As a trader, I want to open any alert on its own page and see all of its details, so that I can understand what happened and share or return to it.

  @AC-1 @FR-1 @FR-2
  Scenario: The alert page shows every detail of the alert
    Given an alert "a1f3" visible to the user with severity "ERROR", category "backfill", source service "xstockstrat-ingest", correlation id "c-77" and context field "job_id" = "67276d1f"
    When the page "/accounts/notifications/a1f3" is opened
    Then it shows "ERROR", "backfill", "xstockstrat-ingest", the created time, the title and the full body
    And it shows "c-77" and the context row "job_id" with "67276d1f"
    And it shows the alert as read

  @AC-2 @FR-3
  Scenario: Another user's alert cannot be opened
    Given an alert "b2e4" targeted at a different user
    When the page "/accounts/notifications/b2e4" is opened
    Then it shows "Alert not found"

  @AC-3 @FR-3
  Scenario: A broadcast alert can be opened by any user
    Given a broadcast alert "c9d0" with no target user
    When the page "/accounts/notifications/c9d0" is opened
    Then it shows the alert's title and body

  @AC-4 @FR-4
  Scenario: A Notifications list row links to the alert page
    Given the Notifications list shows the alert "a1f3"
    When its row is activated
    Then the page "/accounts/notifications/a1f3" is shown

  @AC-5 @FR-4
  Scenario: A drawer row links to the alert page
    Given the header Alerts drawer lists the alert "a1f3"
    When its row is activated
    Then the page "/accounts/notifications/a1f3" is shown

  @AC-6 @FR-5
  Scenario: Opening an unread alert marks it read
    Given the unread alert "a1f3" and a bell badge of "1"
    When the page "/accounts/notifications/a1f3" is opened
    Then the bell shows no unread badge
    And after a reload the Notifications list shows the alert "a1f3" as read

  @AC-7 @FR-6
  Scenario: A push notification opens its alert page
    Given a delivered push notification for the alert "a1f3"
    When the notification is activated
    Then the app opens "/accounts/notifications/a1f3"

  @AC-8 @FR-7
  Scenario: A backfill failure alert reads in plain language
    Given a backfill job "67276d1f" that failed with gRPC status FAILED_PRECONDITION and details "marketdata.fundamentals.history.enabled is false"
    When the failure alert is emitted
    Then its body is "Backfill job 67276d1f failed: FAILED_PRECONDITION — marketdata.fundamentals.history.enabled is false"
    And its body does not contain "AioRpcError"
    And its context field "error" holds the raw exception text

  @AC-9 @FR-3
  Scenario: An alert targeted at the user can be opened
    Given an alert "d4a7" targeted at the user
    When the page "/accounts/notifications/d4a7" is opened
    Then it shows the alert's title and body
