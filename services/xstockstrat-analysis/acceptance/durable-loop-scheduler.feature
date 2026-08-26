# Promoted from docs/roadmap/features/158-durable-loop-scheduler/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-158` tag.
# Durable business rules xstockstrat-analysis already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. These cover the shared
# DurableSchedule helper (sleep-until-due without polling, advance-after-completion, retry cadence),
# the (job_name, user_id)-keyed schedule row, and the wall-clock opportunity-refresh re-anchoring.
# @AC-4/@AC-5 (the fundamentals producer's jitter + redeploy/crash/manual-scan guarantees) stay in
# the feature-156 fix-fundamentals-signal-producer suite; @AC-6 was retired at design (live_loop
# descoped) and its ID is not reused.

Feature: xstockstrat-analysis — durable loop scheduler
  What analysis guarantees for the shared durable-schedule primitive backing its recurring loops: a
  poll-free sleep-until-due that advances only after a completed run (retry cadence on caught error),
  a per-(job, user) schedule row, and wall-clock re-anchoring that survives redeploys.

  @AC-1 @FR-1 @feature-158
  Scenario: The shared helper computes sleep-until-due without polling and advances only after a run
    Given a shared schedule helper in interval mode backing a job "demo" with a "run_interval_hours" of 24
    And the job's schedule row shows a "blocked_until_ms" 6 hours in the future
    When the helper is ticked
    Then it returns a sleep of approximately 6 hours (21600 seconds) and does not invoke the job's run
    And it issues no repeated "poll" write while waiting

  @AC-2 @FR-1 @feature-158
  Scenario: The shared helper writes the next-due time only after a completed interval run
    Given a shared schedule helper in interval mode backing a due job "demo" with a 24h interval
    When the job's run completes successfully
    Then the helper advances "blocked_until_ms" to approximately now + 24h
    And when instead the run raises a caught error it advances by the configured retry cadence, not a full interval

  @AC-3 @FR-2 @feature-158
  Scenario: The generalized schedule row is keyed by job and user
    Given the generalized schedule table keyed by "(job_name, user_id)"
    When a global job seeds its row
    Then the row has an empty/NULL "user_id"
    And a per-user job seeds one distinct row per "(job_name, user_id)" pair

  @AC-7 @FR-5 @feature-158
  Scenario: A migrated loop's jitter and retry cadence are configuration-driven, not hardcoded
    Given a migrated loop reading its startup jitter and retry cadence from config
    And the startup-jitter config value is 30 seconds
    When the loop performs its one-shot startup delay
    Then the delay is a value in the closed interval [0, 30] seconds
    And when the retry-cadence config value is 300 seconds a caught-error run advances the schedule by approximately 300 seconds

  @AC-8 @FR-6 @feature-158
  Scenario: The daily opportunity refresh re-anchors to its wall-clock hour across a redeploy
    Given the opportunity refresh schedules via the shared helper in wall-clock mode anchored to "analysis.opportunity.refresh_hour_utc" of 8
    And it already ran today and persisted a due time of 08:00 UTC tomorrow
    When the process is redeployed the same afternoon
    Then it reads the persisted schedule and next fires at approximately 08:00 UTC tomorrow, not 24h after the redeploy
    And on a first-ever boot before 08:00 UTC it schedules its first run for 08:00 UTC today

  @AC-9 @FR-6 @feature-158
  Scenario: The opportunity refresh retries soon after a user-enumeration failure instead of skipping the day
    Given the opportunity refresh schedules via the shared helper in wall-clock mode with "analysis.opportunity.retry_seconds" of 300
    When the user-enumeration step of a due pass raises an error
    Then the helper advances "blocked_until_ms" by approximately 300 seconds (retry soon), not to the next wall-clock hour
    And when instead the pass completes with only some per-user evaluations failing it advances to the next wall-clock hour, treating those swallowed per-user errors as a completed pass
