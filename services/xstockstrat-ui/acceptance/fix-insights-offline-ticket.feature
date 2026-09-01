# Promoted from docs/roadmap/features/162-fix-insights-offline-ticket/acceptance.feature
# Source: @AC-1 — regression guard scenario
Feature: fix-insights-offline-ticket (regression guard)
  Acceptance scenarios for the xstockstrat-ui service promoted from feature 162 (bug fix).
  Guards against regression of the insights Signal-detail order ticket incorrectly showing
  the offline "Record Offline Order" control when allowOfflineRecord=false.

  @AC-1 @regression @feature-162
  Scenario: insights Signal-detail keeps the broker ticket for an offline-only account
    Given the only registered account is an offline account and it is auto-selected
    When an operator opens the insights Signal-detail page /insights/market/AAPL
    Then the visible order ticket shows the "Place Order" broker heading
    And no "Record Offline Order" control is present (the insights mount forces allowOfflineRecord=false)
