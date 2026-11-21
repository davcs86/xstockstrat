# Promoted from docs/roadmap/features/344-alert-detail-page/acceptance.feature (Constitution C-16).
# Provenance: @feature-344.

Feature: alert-detail-page (ingest backfill-failure alert body)

  @AC-8 @FR-7 @feature-344
  Scenario: A backfill failure alert reads in plain language
    Given a backfill job "67276d1f" that failed with gRPC status FAILED_PRECONDITION and details "marketdata.fundamentals.history.enabled is false"
    When the failure alert is emitted
    Then its body is "Backfill job 67276d1f failed: FAILED_PRECONDITION — marketdata.fundamentals.history.enabled is false"
    And its body does not contain "AioRpcError"
    And its context field "error" holds the raw exception text
