Feature: fix-system-identity-paths (bug fix)
  Regression guard for clustered defect reports: server-initiated and system-owned paths keep owner
  attribution and degrade instead of raising.

  # guards: docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md
  @AC-1 @FR-1 @regression
  Scenario: mcp_client loop signal events are owner-stamped in the ledger
    Given an mcp_client signal source registered by owner "user-a"
    When one ingest.mcp_client.poll_interval_seconds cycle ingests a signal from it
    Then the ingest.signal.ingested ledger event has user_id "user-a"
    And ExportEvents called as "user-a" returns that event

  # guards: docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md
  @AC-2 @FR-2 @regression
  Scenario: A system-owned order event yields a partial P&L snapshot
    Given an order.filled ledger event whose payload has user_id "system"
    When PnLPatternConsumer processes the event
    Then the event is processed on its first attempt with no retry backoff
    And an order_snapshots row is written for that order with empty indicators and signals
    And an analysis.snapshot.degraded event is emitted
    And no pnl_positions window is opened
    And the event is not parked

  # the id persists as the ledger event's correlation_id; ledger ignores the x-trace-id header
  # PRESERVE @AC-41, @AC-28, @AC-29 and @AC-53 @feature-294
  # (services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature): neither user_id nor
  # the per-cycle id becomes a metric label.
  @AC-3 @FR-3
  Scenario: Signals from one mcp_client poll cycle share a per-source correlation id
    Given two mcp_client signal sources registered by owner "user-a", each returning two distinct, non-duplicate signals
    When one poll cycle ingests all four signals
    Then each ingest.signal.ingested ledger event from one source's cycle carries the same non-empty correlation_id
    And the two sources' correlation ids differ
    And no x-user-id is sent
