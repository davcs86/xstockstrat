# Durable business-rule suite for xstockstrat-ingest (Constitution C-16). Promoted from feature 313's
# acceptance.feature (fix-system-identity-paths) at launch; @feature-313 marks provenance. These are the
# guarantees a future feature must not regress (recon reads this suite; the design-adversary enforces it).

Feature: xstockstrat-ingest - mcp_client loop ledger events keep owner attribution and a per-cycle correlation id
  Server-initiated mcp_client poll-loop signal events are attributed to the source owner and share one
  per-source, per-cycle correlation id.

  # guards: docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md
  # PRESERVE @AC-11 @feature-021 (services/xstockstrat-ledger/acceptance/ledger-event-export.feature):
  # the export is scoped to user_id = caller, so an owner-stamped event is returned to its owner.
  @AC-1 @FR-1 @regression @feature-313
  Scenario: mcp_client loop signal events are owner-stamped in the ledger
    Given an mcp_client signal source registered by owner "user-a"
    When one ingest.mcp_client.poll_interval_seconds cycle ingests a signal from it
    Then the ingest.signal.ingested ledger event has user_id "user-a"
    And ExportEvents called as "user-a" returns that event

  # the id persists as the ledger event's correlation_id; ledger ignores the x-trace-id header
  # PRESERVE @AC-41, @AC-28, @AC-29 and @AC-53 @feature-294
  # (@AC-41 is in docs/sdd/business-rules/platform.feature; the others in services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature): neither user_id nor
  # the per-cycle id becomes a metric label.
  @AC-3 @FR-3 @feature-313
  Scenario: Signals from one mcp_client poll cycle share a per-source correlation id
    Given two mcp_client signal sources registered by owner "user-a", each returning two distinct, non-duplicate signals
    When one poll cycle ingests all four signals
    Then each ingest.signal.ingested ledger event from one source's cycle carries the same non-empty correlation_id
    And the two sources' correlation ids differ
    And no x-user-id is sent
