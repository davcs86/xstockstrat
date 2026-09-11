# Promoted from docs/roadmap/features/021-ledger-event-export/acceptance.feature
# Source feature 021 (ledger-event-export). BFF /api/ledger/export route auth edge + trader download control.
Feature: ledger-event-export (ui)
  Acceptance scenarios for the xstockstrat-ui service promoted from feature 021.
  Covers the export BFF route's unauthenticated-request edge and the trader export download control.

  @AC-6 @FR-5 @feature-021
  Scenario: An unauthenticated request is rejected
    Given the browser has no valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the request is rejected with response status 401 (or redirected to the login route)
    And no ExportEvents call is made to the ledger

  @AC-9 @FR-8 @feature-021
  Scenario: The UI download button exports the last 90 days of all event types
    Given a trader is viewing the export control in the xstockstrat-ui on 2026-08-31
    When the trader clicks the "Export events" download button without changing any defaults
    Then the browser requests the export BFF route for the window 2026-06-02 through 2026-08-31 with no event_type filter
    And a file-save dialog is presented to the trader
