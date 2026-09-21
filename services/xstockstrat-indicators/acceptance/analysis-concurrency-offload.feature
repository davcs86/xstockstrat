# Promoted from docs/roadmap/features/176-analysis-concurrency-offload/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-176` tag.
# Durable business rule xstockstrat-indicators guarantees for concurrent off-loop sandbox execution.

Feature: analysis-concurrency-offload
  The indicators sandbox runs concurrent formula executions off the event loop, bounded by
  indicators.sandbox.max_concurrent, so that one slow formula does not serialize all others.

  @AC-5 @FR-5 @feature-176
  Scenario: Concurrent formula executions are no longer serialized to one at a time
    Given indicators.sandbox.max_concurrent is 4
    And 4 ExecuteFormula requests arrive simultaneously, each running a 2-second formula
    When they are processed
    Then all 4 run concurrently off the event loop and complete in about 2 seconds, not about 8 seconds
    And a formula exceeding indicators.sandbox.timeout_ms is still terminated at the timeout
