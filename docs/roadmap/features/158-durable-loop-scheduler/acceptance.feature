Feature: durable-loop-scheduler
  As a platform operator, I want every recurring background loop to inherit feature 156's durable,
  crash-safe schedule from one shared mechanism, so that reliability is uniform and no loop silently
  stops firing under normal deploy churn.

  @AC-1 @FR-1
  Scenario: The shared helper computes sleep-until-due without polling and advances only after a run
    Given a shared schedule helper in interval mode backing a job "demo" with a "run_interval_hours" of 24
    And the job's schedule row shows a "blocked_until_ms" 6 hours in the future
    When the helper is ticked
    Then it returns a sleep of approximately 6 hours (21600 seconds) and does not invoke the job's run
    And it issues no repeated "poll" write while waiting

  @AC-2 @FR-1
  Scenario: The shared helper writes the next-due time only after a completed interval run
    Given a shared schedule helper in interval mode backing a due job "demo" with a 24h interval
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
  Scenario: The fundamentals producer fires within the jitter window on a fresh boot after migration
    Given the fundamentals producer schedules via the shared helper with a bounded startup jitter of N seconds
    And it boots fresh with no prior schedule row
    When the process starts
    Then it runs its first cycle within N seconds of boot (the bounded jitter window), not after a full interval

  @AC-5 @FR-3
  Scenario: The fundamentals producer keeps feature 156's redeploy, crash, and manual-scan guarantees
    Given the fundamentals producer schedules via the shared helper and the generalized table
    And it previously completed a cycle and persisted a future "blocked_until_ms"
    When the process is redeployed before that due time
    Then it reads the persisted schedule and does not re-arm a fresh full interval from the restart moment
    And after a crash mid-cycle (the due time still in the past) the next boot re-runs within the jitter window
    And a manual "RunFundamentalsScan" does not move the scheduled "blocked_until_ms"

  # @AC-6 (live evaluation loop) retired: FR-4 was descoped at design (operator decision, 2026-08-26).
  # The ID is not reused (C-15 append-only); live_loop keeps its in-process asyncio.sleep in v1.

  @AC-7 @FR-5
  Scenario: A migrated loop's jitter and retry cadence are configuration-driven, not hardcoded
    Given a migrated loop reading its startup jitter and retry cadence from config
    And the startup-jitter config value is 30 seconds
    When the loop performs its one-shot startup delay
    Then the delay is a value in the closed interval [0, 30] seconds
    And when the retry-cadence config value is 300 seconds a caught-error run advances the schedule by approximately 300 seconds

  @AC-8 @FR-6
  Scenario: The daily opportunity refresh re-anchors to its wall-clock hour across a redeploy
    Given the opportunity refresh schedules via the shared helper in wall-clock mode anchored to "analysis.opportunity.refresh_hour_utc" of 8
    And it already ran today and persisted a due time of 08:00 UTC tomorrow
    When the process is redeployed the same afternoon
    Then it reads the persisted schedule and next fires at approximately 08:00 UTC tomorrow, not 24h after the redeploy
    And on a first-ever boot before 08:00 UTC it schedules its first run for 08:00 UTC today

  @AC-9 @FR-6
  Scenario: The opportunity refresh retries soon after a user-enumeration failure instead of skipping the day
    Given the opportunity refresh schedules via the shared helper in wall-clock mode with "analysis.opportunity.retry_seconds" of 300
    When the user-enumeration step of a due pass raises an error
    Then the helper advances "blocked_until_ms" by approximately 300 seconds (retry soon), not to the next wall-clock hour
    And when instead the pass completes with only some per-user evaluations failing it advances to the next wall-clock hour, treating those swallowed per-user errors as a completed pass
