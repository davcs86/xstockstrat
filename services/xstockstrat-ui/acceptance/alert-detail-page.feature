# Promoted from docs/roadmap/features/344-alert-detail-page/acceptance.feature (Constitution C-16).
# Provenance: @feature-344.

Feature: alert-detail-page (ui)

  @AC-1 @FR-1 @FR-2 @FR-5 @feature-344
  Scenario: The alert page shows every detail of the alert
    Given an alert "a1f3" visible to the user with severity "ERROR", category "backfill", source service "xstockstrat-ingest", correlation id "c-77" and context field "job_id" = "67276d1f"
    When the page "/accounts/notifications/a1f3" is opened
    Then it shows "ERROR", "backfill", "xstockstrat-ingest", the created time, the title and the full body
    And it shows "c-77" and the context row "job_id" with "67276d1f"
    And it shows the alert as read

  @AC-2 @FR-3 @feature-344
  Scenario: Another user's alert cannot be opened
    Given an alert "b2e4" targeted at a different user
    When the page "/accounts/notifications/b2e4" is opened
    Then it shows "Alert not found"

  @AC-3 @FR-3 @feature-344
  Scenario: A broadcast alert can be opened by any user
    Given a broadcast alert "c9d0" with no target user
    When the page "/accounts/notifications/c9d0" is opened
    Then it shows the alert's title and body

  @AC-4 @FR-4 @feature-344
  Scenario: A Notifications list row links to the alert page
    Given the Notifications list shows the alert "a1f3"
    When its row is activated
    Then the page "/accounts/notifications/a1f3" is shown

  @AC-5 @FR-4 @feature-344
  Scenario: A drawer row links to the alert page
    Given the header Alerts drawer lists the alert "a1f3"
    When its row is activated
    Then the page "/accounts/notifications/a1f3" is shown

  @AC-6 @FR-5 @feature-344
  Scenario: Opening an unread alert marks it read
    Given the unread alert "a1f3" and a bell badge of "1"
    When the page "/accounts/notifications/a1f3" is opened
    Then the bell on that page shows no unread badge
    And after a reload the Notifications list shows the alert "a1f3" as read

  @AC-7 @FR-6 @feature-344
  Scenario: A push notification opens its alert page
    Given a delivered push notification for the alert "a1f3"
    When the notification is activated
    Then the app opens "/accounts/notifications/a1f3"

  @AC-9 @FR-3 @feature-344
  Scenario: An alert targeted at the user can be opened
    Given an alert "d4a7" targeted at the user
    When the page "/accounts/notifications/d4a7" is opened
    Then it shows the alert's title and body

  @AC-10 @FR-8 @feature-344
  Scenario Outline: The header bell is on every page of every segment
    Given a signed-in user with unread alerts
    When the page "<page>" is opened
    Then the header shows the Alerts bell
    And the bell shows the user's unread badge

    Examples:
      | page                    |
      | /trader                 |
      | /insights/opportunities |
      | /config-ui              |
      | /accounts/notifications |
