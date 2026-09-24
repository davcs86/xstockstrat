Feature: alert-read-unread-persistence (ui)
  Promoted from feature 203 (@AC-6). The /accounts/notifications inbox surfaces each alert's level
  (severity), module (category), and body, marks unread alerts with an indicator, and shows a
  server-side unread-count badge.

  @AC-6 @FR-5 @FR-6 @feature-203
  Scenario: The notifications inbox shows level, module, body, and unread state
    Given user "u1" has an unread alert with severity ALERT_SEVERITY_WARNING, category "risk",
      source_service "xstockstrat-portfolio", and body "Drawdown limit approached"
    When user "u1" opens the /accounts/notifications page
    Then the alert row shows the WARNING level, the module "risk" (from category), the body text,
      and an unread indicator
    And an unread count badge is displayed
