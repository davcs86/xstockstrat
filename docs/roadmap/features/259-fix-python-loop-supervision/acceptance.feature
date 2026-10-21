Feature: fix-python-loop-supervision (bug fix)
  Regression guard for docs/reports/2026-10-21-python-loop-supervision-defect.md:
  Python background loops and config watchers die on one exception; the P&L-pattern consumer skips failed events.

  @AC-1 @FR-1 @regression
  Scenario: The fundamentals producer loop keeps ticking after a schedule DB error
    Given a FundamentalsSignalLoop whose durable schedule raises a connection error on the first next_sleep_seconds call and returns 0 after it
    When run_forever runs for two scheduler iterations
    Then the loop task is still running
    And _tick has been called at least once after the error
    And the error was logged

  @AC-2 @FR-1 @regression
  Scenario: The fundamentals producer loop survives a failed cycle whose retry advance also fails
    Given a FundamentalsSignalLoop whose run_once raises a connection error and whose _advance_schedule raises once
    When one scheduler iteration runs
    Then the loop task is still running and schedules a further tick

  @AC-3 @FR-1 @regression
  Scenario Outline: Each servicer background loop survives a schedule DB error
    Given the analysis servicer's "<loop>" whose DurableSchedule raises a connection error once on next_sleep_seconds
    When the loop runs for two iterations
    Then the loop task is still running and the tick ran again after the error

    Examples:
      | loop                               |
      | run_opportunity_refresh_forever    |
      | run_readiness_materializer_forever |
      | run_template_intent_sweep_forever  |

  @AC-4 @FR-2 @regression
  Scenario: Analysis keeps a reference to every background task and logs an unexpected exit
    Given analysis has started its background tasks at boot
    When one background coroutine ends with RuntimeError "boom"
    Then an error naming the task and "boom" is logged
    And no other background task stops running

  @AC-5 @FR-3 @regression
  Scenario Outline: A config watcher reconnects after a non-gRPC exception
    Given the <service> ConfigWatcher whose first WatchConfig stream raises RuntimeError "boom"
    And whose second WatchConfig stream yields a snapshot with version "v2"
    When the watcher runs
    Then WatchConfig is called a second time after a backoff
    And the watcher's snapshot version is "v2"

    Examples:
      | service    |
      | analysis   |
      | indicators |
      | ingest     |

  @AC-6 @FR-4 @regression
  Scenario: A transiently failing ledger event is retried, not skipped past
    Given the P&L-pattern consumer cursor is at 9
    And the ledger streams "portfolio.position.closed" event 10 and event 11
    And processing event 10 raises a connection error once and then succeeds
    When the consumer processes the stream
    Then event 10 is processed successfully before the cursor reaches 11
    And the cursor ends at 11

  @AC-7 @FR-5 @regression
  Scenario: A ledger event that keeps failing is parked and logged, and the cursor moves on
    Given the P&L-pattern consumer cursor is at 9
    And the ledger streams "portfolio.position.closed" event 10 and event 11
    And processing event 10 raises an error on every attempt
    When the consumer processes the stream
    Then event 10 is attempted up to the retry bound and is then parked
    And a log line records that event 10 was parked, with the reason
    And event 11 is processed successfully
    And the cursor ends at 11
