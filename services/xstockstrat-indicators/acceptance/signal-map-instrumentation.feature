# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (indicators)

  @AC-37 @FR-12 @feature-294
  Scenario: Every sandbox failure is counted although the RPC returns OK
    Given ExecuteFormula runs a formula that exceeds timeout_ms 5000
    When the sandbox returns exit_reason "timeout"
    Then "indicators.sandbox.executions" with exit_reason "timeout" increases by 1
    And "indicators.sandbox.duration" records 1 sample for exit_reason "timeout"
    And "indicators.sandbox.queue_wait" records 1 sample
    And a warning log carries exit_reason "timeout"
    And the RPC status is still OK
    And the "executing formula" line is written at DEBUG with its text unchanged and no INFO line is written

  @AC-38 @FR-12 @feature-294
  Scenario: A clean end of the config stream is logged and its age is exposed
    Given the indicators WatchConfig stream ends without raising an exception
    When the watcher loop re-issues the call
    Then an INFO "config stream ended cleanly" line records the clean end
    And gauge "indicators.config.snapshot_age" reports the seconds since the last snapshot
    And the watcher still re-issues the call immediately
