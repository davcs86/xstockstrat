Feature: strategy-eval-projection
  As the platform operator, I want strategy evaluation to run as jobs that write a durable result
  projection and an outbox of transitions, in shadow beside the live loop with a parity report,
  so that I can switch alerts and reads to the new path with evidence.

  Background:
    Given analysis.pipeline.worker_enabled is true
    And analysis.pipeline.evaluation_enabled is true
    And analysis.projection.read_source is "legacy"

  @AC-1 @FR-1
  Scenario: A bar record creates one evaluation job per user who has the symbol
    Given a bar record exists for "AAPL" and 2026-11-27
    And the universe snapshot lists "AAPL" for users "u1" and "u2" and not for user "u3"
    When evaluation jobs are created for that bar record
    Then exactly 1 evaluation job exists for user "u1", "AAPL" and 2026-11-27
    And exactly 1 evaluation job exists for user "u2", "AAPL" and 2026-11-27
    And no evaluation job exists for user "u3" and "AAPL"

  @AC-2 @FR-1
  Scenario: A symbol with no bar record is not evaluated
    Given the coverage record for "ZZZZ" and 2026-11-27 has bar verdict "no_vendor_data"
    When the universe run for 2026-11-27 finishes
    Then no result row exists for "ZZZZ" and 2026-11-27

  @AC-3 @FR-1
  Scenario: A held symbol is evaluated in the held lane
    Given user "u1" holds "AAPL" and only watches "MSFT"
    When evaluation jobs are created for 2026-11-27
    Then the job for user "u1" and "AAPL" is in lane "held"
    And the job for user "u1" and "MSFT" is in lane "watchlist"

  @AC-4 @FR-2
  Scenario: Every active strategy is evaluated, live-enabled or not
    Given user "u1" has active strategies "S1" (live-enabled), "S2" (not live-enabled) and inactive strategy "S3"
    When the evaluation job for user "u1", "AAPL" and 2026-11-27 succeeds
    Then result rows exist for "S1" and "S2" on "AAPL" and 2026-11-27
    And no result row exists for "S3"

  @AC-5 @FR-2
  Scenario: One strategy's failure does not lose another's result
    Given user "u1" has active strategies "S1" and "S2"
    And evaluating "S2" on "AAPL" raises an unreadable-formula error
    When the evaluation job for user "u1", "AAPL" and 2026-11-27 runs
    Then the result row for "S1" holds its decision
    And the result row for "S2" records the failure and no decision

  @AC-6 @FR-3
  Scenario: Re-running an evaluation job writes nothing new
    Given the evaluation job for user "u1", "AAPL" and 2026-11-27 already succeeded with 2 result rows
    When the same job runs again
    Then exactly 2 result rows exist for user "u1", "AAPL" and 2026-11-27
    And neither row's content changed

  @AC-7 @FR-3
  Scenario: An edited formula changes the fingerprint of the next bar's result
    Given strategy "S1" references formula "F1" and has a result row for 2026-11-25 with fingerprint "A"
    And the body of "F1" is edited on 2026-11-26
    When the evaluation job for 2026-11-27 succeeds
    Then the result row for "S1" and 2026-11-27 has a fingerprint different from "A"

  @AC-8 @FR-4
  Scenario: Position state survives a restart without replay
    Given the result row for "S1" on "AAPL" and 2026-11-25 records in-position with entry date 2026-11-20
    And the analysis service restarts
    When the evaluation job for 2026-11-27 runs
    Then it reads in-position and entry date 2026-11-20 from the projection
    And it requests no bars for the purpose of rebuilding state

  @AC-9 @FR-4
  Scenario: The shadow path leaves live-loop state untouched
    When the evaluation job for user "u1", "AAPL" and 2026-11-27 records an entry for "S1"
    Then no row in analysis.strategy_cooldowns is inserted or updated by that job

  @AC-10 @FR-5
  Scenario: A late job does not see later bars
    Given bars for "AAPL" exist through 2026-11-27
    When the evaluation job for bar date 2026-11-25 runs on 2026-11-28
    Then the decision is computed from bars dated 2026-11-25 or earlier only

  @AC-11 @FR-6
  Scenario: An entry transition writes one outbox row with the result
    Given "S1" on "AAPL" is out of position after 2026-11-25
    When the evaluation for 2026-11-27 decides entry
    Then 1 outbox row exists for user "u1", "S1", "AAPL", 2026-11-27 and kind "entry"
    And the result row and the outbox row were committed together

  @AC-12 @FR-6
  Scenario: A retried job does not duplicate the outbox row
    Given the evaluation for 2026-11-27 decided entry and its job is retried after a lost lease
    When the retry completes
    Then exactly 1 outbox row exists for user "u1", "S1", "AAPL", 2026-11-27 and kind "entry"

  @AC-13 @FR-6
  Scenario: A bar with no transition writes no outbox row
    Given "S1" on "AAPL" is in position after 2026-11-25
    When the evaluation for 2026-11-27 decides neither entry nor exit
    Then no outbox row exists for "S1", "AAPL" and 2026-11-27

  @AC-14 @FR-7
  Scenario: The dispatcher suppresses delivery
    Given 1 pending outbox row of kind "entry"
    When the dispatcher drains the outbox
    Then the row is in state "suppressed"
    And notify.EmitAlert was called 0 times and ledger.AppendEvent was called 0 times

  @AC-15 @FR-8
  Scenario: With the legacy source, reads are unchanged
    Given analysis.projection.read_source is "legacy"
    And the projection holds result rows for user "u1"
    When user "u1" calls ListOpportunities, EvaluateReadiness and GetWatchlistReadiness
    Then each response is produced by the legacy code path and reads no result row

  @AC-16 @FR-8
  Scenario: With the projection source, a read is a pure read
    Given analysis.projection.read_source is "projection"
    And the projection holds an entry-ready result for user "u1", "S1" and "AAPL"
    When user "u1" calls ListOpportunities
    Then the response contains an opportunity for "AAPL" and "S1"
    And no job is enqueued, no recompute is kicked and no bars are fetched by the read

  @AC-17 @FR-8
  Scenario: With the projection source, a user with no results gets an empty page without compute
    Given analysis.projection.read_source is "projection"
    And the projection holds no result row for user "u9"
    When user "u9" calls ListOpportunities
    Then the response has 0 opportunities
    And no job is enqueued and no recompute is kicked

  @AC-18 @FR-9
  Scenario: The parity report counts agreement on the overlap
    Given for bar 2026-11-27 both paths cover 40 pairs and agree on 39 transitions
    And the new path covers 25 further pairs the live path does not
    When the parity step for the run of 2026-11-27 runs
    Then the logged report states 40 compared, 39 matching, 1 mismatching and 25 new-path-only
    And the mismatch is logged with its user, strategy, symbol, bar date and both values

  @AC-19 @FR-9
  Scenario: Mismatch detail is bounded and the total is always reported
    Given 500 mismatching pairs for bar 2026-11-27 and a per-run detail bound of 100
    When the parity step runs
    Then 100 mismatches are logged in detail
    And the report states 500 mismatching

  @AC-20 @FR-10
  Scenario: The drain time of a run is exported
    Given the first bar record of the run of 2026-11-27 was written at 21:10:00 UTC
    And its last evaluation job finished at 21:22:30 UTC
    When the run completes
    Then telemetry reports a drain time of 750 seconds for that run

  @AC-21 @FR-11
  Scenario: The kill switch stops the shadow path
    Given analysis.pipeline.evaluation_enabled is false
    When a bar record is written for "AAPL" and 2026-11-27
    Then no evaluation job, result row or outbox row is created for it

  @AC-22 @FR-11
  Scenario: The new path sends nothing while in shadow
    Given the run of 2026-11-27 produced 12 transitions on the new path
    When the run and the dispatcher have finished
    Then the new path caused 0 notify alerts and 0 ledger events

  @AC-23 @FR-12
  Scenario: Retention keeps the latest row and every transition
    Given "S1" on "AAPL" has result rows for 30 consecutive sessions of which 2 are transitions
    When the retention prune runs
    Then the latest result row and the 2 transition rows remain
    And the other non-transition rows older than the retention window are deleted
