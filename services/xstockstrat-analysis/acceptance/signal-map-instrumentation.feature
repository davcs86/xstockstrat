# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (analysis)

  @AC-15 @FR-5 @feature-294
  Scenario: The live loop counts errored pairs while still logging the registered literal
    Given a live cycle that evaluates 10 pairs where 10 raise an exception
    When the cycle ends
    Then "analysis.live_loop.pairs" with outcome "error" increases by 10
    And the log text "live_loop: cycle complete" is still written exactly once

  @AC-16 @FR-5 @feature-294
  Scenario: A failed portfolio drain is counted as a degraded universe
    Given the portfolio ListPositions call fails for owner "o-1"
    When the live loop drains held positions
    Then "analysis.live_loop.drain_failures" with source "held" increases by 1
    And no metric attribute contains "o-1"

  @AC-17 @FR-5 @feature-294
  Scenario: A fundsignal run reports its emit outcome in a summary line
    Given a scheduled scan of a 200-symbol universe where 150 symbols are scored, each at or above min_conviction_to_emit, and none was emitted earlier today
    And IngestSignal fails with UNAVAILABLE (not NOT_FOUND) for all 150
    When the fundsignal _tick runs the scan
    Then "analysis.fundsignal.signals" with outcome "failed" increases by 150
    And exactly 1 INFO "fundsignal run summary" line carries universe 200, scored 150, attempted 150, emitted 0 and emit_failed 150
    And no "loop tick ok" record with loop "fundsignal" is written for that tick
    And the run status is unchanged from today's behavior

  @AC-18 @FR-5 @feature-294
  Scenario: Loop error logs carry a traceback and per-component INFO moves to DEBUG
    Given a live-loop cycle that raises KeyError('x')
    And a live evaluation of a strategy whose formula has a fundamentals input
    When the handler logs the error
    Then the log record has exc_info set
    And the evaluator's "fundamentals formula=" line is emitted at DEBUG, not INFO

  # Feature 337: apart from the platform-wide `host.provider` export label added after aggregation, the keys are unchanged (sign-off in 337 context.md).
  @AC-51 @FR-5 @feature-294
  Scenario: Live-loop triggers, cycle duration and opportunity recompute are recorded
    Given a live cycle of 60 seconds interval that sends 1 entry alert, throttles 1 exit alert and takes 1.4 seconds
    And a background full opportunity recompute that fails once
    And a fundsignal _tick whose run_once raises, and a supervised tick that raises
    When the cycle ends and the recompute finishes
    Then "analysis.live_loop.triggers" increases by 1 for trigger "entry" outcome "alerted" and by 1 for trigger "exit" outcome "throttled"
    And the unlabelled "analysis.live_loop.cycle.duration" histogram records 1 sample of about 1.4 seconds
    And "analysis.opportunity.recompute" with kind "full" and outcome "failed" increases by 1
    And the "fundsignal: cycle error" log and the supervised "tick error" log have exc_info set
