Feature: durable-loop-scheduler
  As a platform operator, I want every interval background loop to inherit feature 156's durable,
  crash-safe schedule from one shared mechanism, so that reliability is uniform and no loop silently
  stops firing under normal deploy churn.

  @AC-1 @FR-1
  Scenario: The shared helper computes sleep-until-due without polling and advances only after a run
    Given a shared schedule helper backing a job "demo" with a "run_interval_hours" of 24
    And the job's schedule row shows a "blocked_until_ms" 6 hours in the future
    When the helper is ticked
    Then it returns a sleep of approximately 6 hours and does not invoke the job's run
    And it issues no repeated "poll" write while waiting

  @AC-2 @FR-1
  Scenario: The shared helper writes the next-due time only after a completed run
    Given a shared schedule helper backing a due job "demo" with a 24h interval
    When the job's run completes successfully
    Then the helper advances "blocked_until_ms" to approximately now + 24h
    And when instead the run raises a caught error it advances by the configured retry cadence, not a full interval

  @AC-3 @FR-2
  Scenario: The generalized schedule row is keyed by job and user
    Given the generalized schedule table keyed by "(job_name, user_id)"
    When a global job seeds its row
    Then the row has an empty/NULL "user_id"
    And a per-user job seeds one distinct row per "(job_name, user_id)" pair

  @AC-4 @FR-3
  Scenario: The fundamentals producer keeps feature 156's guarantees after migration onto the shared helper
    Given the fundamentals producer now schedules via the shared helper and the generalized table
    When the producer boots fresh, restarts within its interval, crashes mid-cycle, or a manual scan runs
    Then it fires promptly on a fresh boot, does not reset its cadence on a redeploy, re-runs promptly after a crash
    And a manual "RunFundamentalsScan" still does not move the scheduled cadence

  @AC-5 @FR-4
  Scenario: The live evaluation loop fires promptly on boot and survives a redeploy after migration
    Given the live evaluation loop schedules via the shared helper as a global job
    And it previously completed a cycle and persisted a future due time
    When the process is redeployed before that due time
    Then it reads the persisted schedule and does not re-arm a fresh full interval from the restart moment
    And on a first-ever boot with no prior schedule it runs its first cycle promptly (after the bounded jitter)

  @AC-6 @FR-5
  Scenario: A migrated loop's jitter and retry cadence are configuration-driven, not hardcoded
    Given a migrated loop reading its startup jitter and retry cadence from config
    When the startup-jitter config value is N seconds
    Then the one-shot startup delay is a value in the closed interval [0, N] seconds
    And no jitter or retry duration is a literal baked into the loop source
