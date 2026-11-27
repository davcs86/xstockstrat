Feature: pipeline-job-graph
  As the platform operator, I want a durable job graph and worker runtime in xstockstrat-analysis,
  so that later features can replace the in-process analysis loops with per-item jobs.

  Background:
    Given analysis.pipeline.worker_enabled is true
    And analysis.pipeline.lease_seconds is 60
    And analysis.pipeline.max_attempts is 5

  @AC-1 @FR-1
  Scenario: Enqueuing the same key twice creates one job
    When a job of kind "probe" for subject "AAPL" and epoch "2026-11-27" is enqueued twice
    Then exactly 1 job exists for that kind, subject and epoch
    And the second enqueue reports the existing job

  @AC-2 @FR-2
  Scenario: Two workers cannot hold the same job
    Given 1 ready job and 2 workers polling at the same time
    When both workers try to claim it
    Then exactly 1 worker holds the lease
    And the job's handler runs once

  @AC-3 @FR-2
  Scenario: A job whose worker died is taken over after the lease expires
    Given worker A holds a job and stops sending heartbeats
    When 60 seconds pass and worker B polls
    Then worker B holds the lease
    And the job's attempt count is 2

  @AC-4 @FR-2
  Scenario: A stale worker cannot complete a job it lost
    Given worker A lost its lease on a job to worker B
    And worker B reports the job as succeeded
    When worker A reports the job as succeeded
    Then the report is rejected
    And the job's recorded result is worker B's

  @AC-5 @FR-3
  Scenario: A transient failure is retried after a delay
    Given a job whose handler raises a transient error on attempt 1
    When the attempt fails
    Then the job is ready again with attempt count 1 recorded
    And no worker can claim it within 5 seconds of the failure

  @AC-6 @FR-3
  Scenario: A permanent failure is not retried
    Given a job whose handler raises a permanent error on attempt 1
    When the attempt fails
    Then the job is in state "failed" with the error class "permanent"
    And no worker claims it again

  @AC-7 @FR-3
  Scenario: A job that keeps failing ends in the dead-letter state
    Given a job whose handler raises a transient error on every attempt
    When attempt 5 fails
    Then the job is in state "dead"
    And no worker claims it again

  @AC-8 @FR-4
  Scenario: A parent parks until its child succeeds
    Given a parent job that declared a dependency on a child job
    Then no worker can claim the parent while the child is not finished
    When the child succeeds
    Then the parent is ready and a worker claims it

  @AC-9 @FR-4
  Scenario: An unsatisfiable child blocks its parent for good
    Given a parent job waiting on a child job
    When the child finishes with the terminal verdict "no_vendor_data"
    Then the parent is in state "blocked" with the verdict "no_vendor_data"
    And the parent's handler does not run again

  @AC-10 @FR-5
  Scenario: The held lane is served before the watchlist lane
    Given 1 ready job in lane "watchlist" enqueued at 09:00 and 1 ready job in lane "held" enqueued at 09:01
    When one worker claims one job
    Then it claims the job in lane "held"

  @AC-11 @FR-6
  Scenario: Jobs are grouped by universe run
    Given 3 jobs enqueued under run "run-2026-11-27" and 1 job under run "run-2026-11-26"
    When the jobs of run "run-2026-11-27" are listed
    Then 3 jobs are returned, each with its current state

  @AC-12 @FR-7
  Scenario: Finished jobs are pruned and dead jobs are kept
    Given analysis.pipeline.retention_days is 7
    And 1 succeeded job finished 8 days ago and 1 dead job finished 8 days ago
    When the retention prune runs
    Then the succeeded job no longer exists
    And the dead job still exists

  @AC-13 @FR-8
  Scenario: Queue depth and age are measurable
    Given 4 ready jobs in lane "watchlist", the oldest enqueued 120 seconds ago
    When the queue metrics are exported
    Then the ready depth for lane "watchlist" is 4
    And the oldest-ready age for lane "watchlist" is at least 120 seconds

  @AC-14 @FR-9
  Scenario: Nothing runs while the worker is disabled
    Given analysis.pipeline.worker_enabled is false
    And 1 ready job exists
    When 10 seconds pass
    Then the job is still ready with attempt count 0

  @AC-15 @FR-7 @FR-1
  Scenario: The daily prune runs once across instances
    Given 2 analysis instances are running on 2026-11-27 (UTC)
    When both instances run a claim poll
    Then exactly 1 job of kind "pipeline.retention_prune" exists for epoch "2026-11-27"
    And it finishes in state "succeeded"

  @AC-16 @FR-9
  Scenario: The kill switch also stops the daily prune
    Given analysis.pipeline.worker_enabled is false
    When 10 seconds pass on 2026-11-27 (UTC)
    Then no job of kind "pipeline.retention_prune" exists for epoch "2026-11-27"
