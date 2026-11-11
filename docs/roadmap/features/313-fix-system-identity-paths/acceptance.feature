Feature: fix-system-identity-paths (bug fix)
  Regression guard for clustered defect reports: server-initiated and system-owned paths keep owner
  attribution and degrade instead of raising.

  # guards: docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md
  @AC-1 @regression
  Scenario: mcp_client loop signal events are owner-stamped in the ledger
    Given an mcp_client signal source registered by owner "user-a"
    When one ingest.mcp_client.poll_interval_seconds cycle ingests a signal from it
    Then the ingest.signal.ingested ledger event has user_id "user-a"
    And ExportEvents called as "user-a" returns that event

  # guards: docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md
  @AC-2 @regression
  Scenario: A system-owned order event yields a partial P&L snapshot
    Given an order.filled ledger event whose payload has user_id "system"
    When PnLPatternConsumer processes the event
    Then _compose does not raise
    And an order_snapshots row is written for that order, marked degraded, without indicators or signals
    And the event is not parked
