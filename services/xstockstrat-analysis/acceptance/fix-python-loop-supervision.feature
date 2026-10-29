# Promoted from docs/roadmap/features/259-fix-python-loop-supervision/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-259` tag.
# Durable business rules: analysis background loops and the P&L-pattern consumer survive transient
# errors and never silently skip a ledger event. A rule enters only by promotion, never hand-authoring.

Feature: xstockstrat-analysis — background loop supervision
  What analysis guarantees about its recurring loops, background tasks and the P&L-pattern ledger consumer
  under transient failures.

  @AC-1 @FR-1 @regression @feature-259
  Scenario: The fundamentals producer loop keeps ticking after a schedule DB error
    Given a FundamentalsSignalLoop whose durable schedule raises a connection error on the first next_sleep_seconds call and returns 0 after it
    When run_forever runs for two scheduler iterations
    Then the loop task is still running
    And _tick has been called at least once after the error
    And the error was logged

  @AC-2 @FR-1 @regression @feature-259
  Scenario: The fundamentals producer loop survives a failed cycle whose retry advance also fails
    Given a FundamentalsSignalLoop whose run_once raises a connection error and whose _advance_schedule raises once
    When one scheduler iteration runs
    Then the loop task is still running
    And a further tick runs
    And the connection error was logged

  @AC-3 @FR-1 @regression @feature-259
  Scenario Outline: Each servicer background loop survives a schedule DB error
    Given the analysis servicer's "<loop>" whose DurableSchedule raises a connection error once on next_sleep_seconds
    When the loop runs for two iterations
    Then the loop task is still running and the tick ran again after the error

    Examples:
      | loop                               |
      | run_opportunity_refresh_forever    |
      | run_readiness_materializer_forever |
      | run_template_intent_sweep_forever  |

  @AC-4 @FR-2 @regression @feature-259
  Scenario: Analysis keeps a reference to every background task and logs an unexpected exit
    Given analysis has started its background tasks at boot
    When one background coroutine ends with RuntimeError "boom"
    Then an error naming the task and "boom" is logged
    And no other background task stops running

  @AC-6 @FR-4 @regression @feature-259
  Scenario: A transiently failing ledger event is retried, not skipped past
    Given the P&L-pattern consumer cursor is at 9
    And the ledger streams "portfolio.position.closed" event 10 and event 11
    And processing event 10 raises a connection error once and then succeeds
    When the consumer processes the stream
    Then event 10 is processed successfully before the cursor reaches 11
    And the cursor ends at 11

  @AC-7 @FR-5 @regression @feature-259
  Scenario Outline: A ledger event that keeps failing is parked and recorded, and the cursor moves on
    Given the P&L-pattern consumer cursor is at 9
    And the ledger streams "portfolio.position.closed" event 10 and event 11
    And the consumer's retry bound is 3 attempts and its replay escalation threshold is 5
    And processing event 10 raises <error> on every attempt
    And the bounded DB-health probe succeeds
    When the consumer processes the stream
    Then event 10 is attempted exactly <attempts> times and is then parked with reason "<reason>"
    And a log line records that event 10 was parked, with the reason
    And an "analysis.pnl.event_parked" ledger event records sequence 10 with idempotency key "pnl_park:10"
    And event 11 is processed successfully
    And the cursor ends at 11

    Examples:
      | error                                                         | attempts | reason               |
      | a poison error (ValueError, or asyncpg SQLSTATE class 22/23)  | 3        | non-transient        |
      | a non-poison error that persists (asyncpg OutOfMemoryError)   | 15       | transient-persistent |

  @AC-9 @FR-5 @regression @feature-259
  Scenario Outline: A non-poison failure is replayed, not parked, while the DB-health probe fails
    Given the P&L-pattern consumer cursor is at 9
    And every reconnect re-delivers the cursor's own event 9 before event 10
    And processing event 10 raises <error> on every attempt
    And the bounded DB-health probe <probe outcome>
    When the consumer has replayed event 10 five times
    Then event 10 is not parked and the cursor stays at 9
    And the 5th replay logs ERROR naming sequence 10
    And the re-delivered event 9 never resets the replay count

    Examples:
      | error                               | probe outcome |
      | an asyncpg OutOfMemoryError         | raises        |
      | an asyncpg DeadlockDetectedError    | times out     |

  @AC-10 @FR-5 @regression @feature-259
  Scenario: A consumer whose cursor read fails on every reconnect escalates to ERROR
    Given the P&L-pattern consumer's cursor read raises a connection error on every call
    When the consumer has failed to open the ledger stream 5 consecutive times
    Then the first 4 failures log WARNING
    And the 5th consecutive failure logs ERROR
