# Promoted from docs/roadmap/features/021-ledger-event-export/acceptance.feature
# Source feature 021 (ledger-event-export). ExportEvents server-streaming RPC acceptance guarantees.
Feature: ledger-event-export (ledger)
  Acceptance scenarios for the xstockstrat-ledger service promoted from feature 021.
  Covers the ExportEvents streaming RPC: event_type filtering, window/flag enforcement,
  per-user scoping, and exported-row field shape.

  @AC-3 @FR-3 @feature-021
  Scenario: event_type filter restricts the export to the listed types
    Given the ledger holds fill, signal, and pnl_snapshot events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31&event_type=fill,signal"
    Then the response status is 200
    And every returned row has an "event_type" of either "fill" or "signal"
    And no "pnl_snapshot" row is present

  @AC-4 @FR-3 @feature-021
  Scenario: Omitting event_type returns all five event types
    Given the ledger holds fill, signal, pnl_snapshot, config_change, and alert events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the response status is 200
    And the returned rows include all of: "fill", "signal", "pnl_snapshot", "config_change", "alert"

  @AC-5 @FR-4 @feature-021
  Scenario: A window wider than the configured maximum is rejected
    Given "ledger.export.max_window_days" is set to 365
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2025-01-01&end=2026-06-01"
    Then the ledger rejects ExportEvents with gRPC InvalidArgument
    And the BFF returns response status 400
    And the error message is "window exceeds ledger.export.max_window_days"

  @AC-8 @FR-7 @feature-021
  Scenario: Each exported row carries the required fields
    Given the ledger holds one fill event with event_id "evt_9f21" at 2026-02-15T14:30:00Z from source_service "xstockstrat-trading" for user_id "u_42" with correlation_id "corr_7c3"
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-02-01&end=2026-02-28"
    Then the response status is 200
    And the row for "evt_9f21" has keys "event_id", "event_type", "occurred_at", "source_service", "correlation_id", "sequence", "stream_key", "user_id", "payload"
    And its "user_id" is "u_42"
    And its "payload" is a JSON object

  @AC-10 @FR-9 @feature-021
  Scenario: Export is disabled when the feature flag is off
    Given "ledger.export.enabled" is set to false
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the ledger rejects ExportEvents because the export feature is disabled
    And the BFF returns response status 403
    And no events are streamed

  @AC-11 @FR-10 @feature-021
  Scenario: The export returns only the authenticated user's own events
    Given the ledger holds a fill event "evt_a1" for user_id "u_42" and a fill event "evt_b2" for user_id "u_99", both between 2026-02-01 and 2026-02-28
    And the browser has a valid authenticated session for user_id "u_42"
    When the browser requests "GET .../api/ledger/export?start=2026-02-01&end=2026-02-28"
    Then the response status is 200
    And the export contains the row for "evt_a1"
    And the export does not contain the row for "evt_b2"
