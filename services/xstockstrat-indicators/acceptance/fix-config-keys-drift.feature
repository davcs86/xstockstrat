# Promoted from docs/roadmap/features/295-fix-config-keys-drift/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-295` tag.
# Durable business rules xstockstrat-indicators guarantees for live sandbox concurrency and timeout config.

Feature: xstockstrat-indicators - live sandbox config
  What xstockstrat-indicators guarantees: sandbox limits follow config without a restart and respect the caller's deadline.

  @AC-6 @FR-7 @regression @feature-295
  Scenario: A concurrency limit shrinks without a restart or a cancelled execution
    Given indicators is running with "indicators.sandbox.max_concurrent" = 4 and 4 formulas executing
    When an operator sets it to 2
    Then all 4 in-flight executions complete
    And from then on at most 2 formulas execute concurrently

  @AC-18 @FR-12 @regression @feature-295
  Scenario: test_formula honours the configured sandbox timeout
    Given staging "indicators.sandbox.timeout_ms" = 15000 and "indicators.sandbox.startup_grace_ms" = 5000
    When test_formula runs a formula that takes 12 seconds
    Then it returns success, not DEADLINE_EXCEEDED

  @AC-38 @FR-12 @regression @feature-295
  Scenario: The sandbox timeout is clamped to the request's remaining deadline
    Given "indicators.sandbox.timeout_ms" = 15000 and "indicators.sandbox.startup_grace_ms" = 5000
    When ExecuteFormula arrives with 8 seconds of deadline remaining
    Then the formula runs with an effective timeout of at most 2500 ms
    And when the remaining deadline leaves under 100 ms the call returns success=false naming the remaining time and spawns no sandbox
