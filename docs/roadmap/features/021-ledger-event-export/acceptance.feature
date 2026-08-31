Feature: ledger-event-export
  As a trader, I want to download a structured export of all ledger events for a date range,
  so that I can prepare tax filings, review which signals preceded my best trades, and satisfy audit requirements.

  # Transport model: the browser calls the xstockstrat-ui BFF export route
  # (".../api/ledger/export", exact segment decided at design). The BFF authenticates the
  # session, forwards the identity headers (x-user-id / x-access-scope / x-trace-id injected by
  # the ui middleware), and calls the ledger server-streaming gRPC RPC
  # ExportEvents(ExportEventsRequest) returns (stream ExportEventsResponse) on port 50057,
  # serializing the streamed rows back to the browser as NDJSON (default) or CSV.

  @AC-1 @FR-1 @FR-2
  Scenario: Date-range export streams every event as NDJSON in global-sequence order
    Given the ledger holds 1,200 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the response status is 200
    And the "Content-Type" is "application/x-ndjson"
    And the body contains 1,200 newline-delimited JSON objects, one per event in that window
    And the objects appear in ascending ledger global-sequence order

  @AC-2 @FR-2
  Scenario: CSV format returns a header row and one data row per event
    Given the ledger holds 3 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31&format=csv"
    Then the response status is 200
    And the "Content-Type" is "text/csv"
    And the first line is the header "event_id,event_type,occurred_at,service_origin,payload,user_id"
    And 3 data rows follow, one per event

  @AC-3 @FR-3
  Scenario: event_type filter restricts the export to the listed types
    Given the ledger holds fill, signal, and pnl_snapshot events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31&event_type=fill,signal"
    Then the response status is 200
    And every returned row has an "event_type" of either "fill" or "signal"
    And no "pnl_snapshot" row is present

  @AC-4 @FR-3
  Scenario: Omitting event_type returns all five event types
    Given the ledger holds fill, signal, pnl_snapshot, config_change, and alert events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the response status is 200
    And the returned rows include all of: "fill", "signal", "pnl_snapshot", "config_change", "alert"

  @AC-5 @FR-4
  Scenario: A window wider than the configured maximum is rejected
    Given "ledger.export.max_window_days" is set to 365
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2025-01-01&end=2026-06-01"
    Then the ledger rejects ExportEvents with gRPC InvalidArgument
    And the BFF returns response status 400
    And the error message is "window exceeds ledger.export.max_window_days"

  @AC-6 @FR-5
  Scenario: An unauthenticated request is rejected
    Given the browser has no valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the request is rejected with response status 401 (or redirected to the login route)
    And no ExportEvents call is made to the ledger

  @AC-7 @FR-6
  Scenario: A one-million-row export streams without buffering the full result set
    Given the ledger holds 1,000,000 events between 2026-01-01 and 2026-03-31
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the response status is 200
    And all 1,000,000 rows are streamed to the client
    And the ledger reads rows from a DB cursor and emits them on the ExportEvents stream, and the BFF pipes each message straight to the HTTP response, so neither process buffers the full result set

  @AC-8 @FR-7
  Scenario: Each exported row carries the required fields
    Given the ledger holds one fill event with event_id "evt_9f21" at 2026-02-15T14:30:00Z from service_origin "xstockstrat-trading" for user_id "u_42"
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-02-01&end=2026-02-28"
    Then the response status is 200
    And the row for "evt_9f21" has keys "event_id", "event_type", "occurred_at", "service_origin", "payload", "user_id"
    And its "payload" is a JSON object

  @AC-9 @FR-8
  Scenario: The UI download button exports the last 90 days of all event types
    Given a trader is viewing the export control in the xstockstrat-ui on 2026-08-31
    When the trader clicks the "Export events" download button without changing any defaults
    Then the browser requests the export BFF route for the window 2026-06-02 through 2026-08-31 with no event_type filter
    And a file-save dialog is presented to the trader

  @AC-10 @FR-9
  Scenario: Export is disabled when the feature flag is off
    Given "ledger.export.enabled" is set to false
    And the browser has a valid authenticated session
    When the browser requests "GET .../api/ledger/export?start=2026-01-01&end=2026-03-31"
    Then the ledger rejects ExportEvents because the export feature is disabled
    And the BFF returns response status 403
    And no events are streamed
