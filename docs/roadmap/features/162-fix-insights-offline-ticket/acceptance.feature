Feature: fix-insights-offline-ticket (bug fix)
  Regression guard for the defect report
  2026-08-27-insights-signal-ticket-offline-account-flake-defect.md: the insights Signal-detail
  order ticket must keep the broker ticket for an offline account.

  @AC-1 @regression
  Scenario: insights Signal-detail keeps the broker ticket for an offline-only account
    Given the only registered account is an offline account and it is auto-selected
    When an operator opens the insights Signal-detail page /insights/market/AAPL
    Then the visible order ticket shows the "Place Order" broker heading
    And no "Record Offline Order" control is present (the insights mount forces allowOfflineRecord=false)
