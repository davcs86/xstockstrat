# Business-rule suite: xstockstrat-ui — fix-insights-offline-ticket
# Promoted from docs/roadmap/features/162-fix-insights-offline-ticket/acceptance.feature
# by /sdd-archiver on 2026-08-31 per Constitution C-16.

Feature: insights signal-detail order ticket broker intent
  The insights Signal-detail order ticket must force broker-execution intent regardless of the
  viewer's account type — the offline "Record Offline Order" affordance is only appropriate on
  the trader and orders pages, not on the insights signal-detail path.

  @AC-1 @feature-162 @regression
  Scenario: insights Signal-detail keeps the broker ticket for an offline-only account
    Given the only registered account is an offline account and it is auto-selected
    When an operator opens the insights Signal-detail page /insights/market/AAPL
    Then the visible order ticket shows the "Place Order" broker heading
    And no "Record Offline Order" control is present (the insights mount forces allowOfflineRecord=false)
