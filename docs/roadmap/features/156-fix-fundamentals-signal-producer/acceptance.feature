Feature: fix-fundamentals-signal-producer (bug fix + operator-expanded scope)
  Regression guard for defect 2026-08-25-fundsignal-first-cycle-resets-on-redeploy, plus the
  operator-steered durable schedule, startup jitter, and manual UI/MCP trigger. The fundamentals
  signal producer must fire its first cycle promptly after startup, keep a crash-safe durable
  schedule across redeploys, and be manually triggerable by an admin.

  @AC-1 @regression
  Scenario: The producer runs its first cycle promptly on a fresh deploy, not after a full interval
    Given "analysis.fundsignal.enabled" is true and the resolved universe is non-empty
    And the process starts with no prior schedule row (or a seeded due time of 0)
    When the producer loop begins and the startup jitter elapses
    Then it invokes its first "run_once" cycle without first sleeping a full "run_interval_hours"
    And the "fundamentals" signal source becomes registered within the startup window

  @AC-2 @regression
  Scenario: A redeploy within the interval does not reset the schedule
    Given a producer previously completed a cycle and persisted a future "blocked_until_ms"
    And the process restarts before that due time (a CI/CD redeploy)
    When the producer loop begins
    Then it reads the existing schedule row and sleeps only the remaining time until due
    And it does not re-arm a fresh full "run_interval_hours" from the restart moment

  @AC-3 @regression
  Scenario: A hard crash mid-cycle re-runs promptly on restart, not after a full interval
    Given the schedule is due and a cycle begins but the process is killed before it completes
    And "blocked_until_ms" was therefore never advanced (it stays at its past value)
    When the process restarts
    Then the schedule is immediately due and the next cycle runs promptly

  @AC-4
  Scenario: A caught cycle error retries after retry_seconds, not a full interval
    Given the schedule is due and "run_once" raises a caught exception
    When the loop handles the failure
    Then it advances "blocked_until_ms" by "analysis.fundsignal.retry_seconds", not by "run_interval_hours"

  @AC-5
  Scenario: A disabled producer neither runs nor advances the schedule
    Given "analysis.fundsignal.enabled" is false and the schedule is due
    When the producer loop ticks
    Then it does not call "run_once"
    And it does not advance "blocked_until_ms"
    And it does not busy-spin

  @AC-6
  Scenario: A manual scan does not contaminate the scheduled cadence
    Given a completed schedule row with a future "blocked_until_ms"
    When an admin invokes "RunFundamentalsScan" (including a dry_run or an explicit symbols override)
    Then "run_once" executes for that manual request
    But the "analysis.fundsignal_schedule" row's "blocked_until_ms" is unchanged

  @AC-7
  Scenario: Startup jitter is bounded
    Given "analysis.fundsignal.startup_jitter_seconds" is configured to N
    When the producer loop begins
    Then the one-shot startup delay is a value in the closed interval [0, N] seconds

  @AC-8
  Scenario: The MCP tool triggers a scan for an admin and rejects a non-admin
    Given the agent "run_fundamentals_scan" tool is invoked
    When the caller carries the admin access scope
    Then the tool forwards the caller's derived scope and the backend runs the scan
    And when the caller lacks the admin scope the backend rejects it with PERMISSION_DENIED

  @AC-9
  Scenario: The config-ui trigger control is admin-gated
    Given the config-ui "Run fundamentals scan" control
    When a non-admin session reaches the BFF route
    Then the admin-forwarding BFF gate rejects the request
    And the control is reachable from config-ui navigation for an admin session
