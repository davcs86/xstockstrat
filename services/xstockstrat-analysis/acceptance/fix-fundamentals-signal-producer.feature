# Durable business-rule suite for xstockstrat-analysis (Constitution C-16). Promoted from feature 156's
# acceptance.feature on code-completion; @feature-156 marks provenance. These are the guarantees a
# future feature must not regress (recon reads this suite; the design-adversary enforces it).
# This is analysis's first acceptance suite — the fundamentals producer's scheduling/idempotency
# guarantees lived only in code + feature 062/154/156 specs before this promotion.

Feature: Fundamentals signal producer — durable, crash-safe schedule
  The producer's scheduled loop fires promptly on boot and keeps a durable schedule that survives
  redeploys and crashes, without re-emitting or letting a manual scan move the scheduled cadence.

  @AC-1 @feature-156
  Scenario: The producer runs its first cycle promptly on a fresh deploy, not after a full interval
    Given "analysis.fundsignal.enabled" is true and the resolved universe is non-empty
    And the process starts with no prior schedule row (or a seeded due time of 0)
    When the producer loop begins and the startup jitter elapses
    Then it invokes its first "run_once" cycle without first sleeping a full "run_interval_hours"
    And the "fundamentals" signal source becomes registered within the startup window

  @AC-2 @feature-156
  Scenario: A redeploy within the interval does not reset the schedule
    Given a producer previously completed a cycle and persisted a future "blocked_until_ms"
    And the process restarts before that due time (a CI/CD redeploy)
    When the producer loop begins
    Then it reads the existing schedule row and sleeps only the remaining time until due
    And it does not re-arm a fresh full "run_interval_hours" from the restart moment

  @AC-3 @feature-156
  Scenario: A hard crash mid-cycle re-runs promptly on restart, not after a full interval
    Given the schedule is due and a cycle begins but the process is killed before it completes
    And "blocked_until_ms" was therefore never advanced (it stays at its past value)
    When the process restarts
    Then the schedule is immediately due and the next cycle runs promptly

  @AC-4 @feature-156
  Scenario: A caught cycle error retries after retry_seconds, not a full interval
    Given the schedule is due and "run_once" raises a caught exception
    When the loop handles the failure
    Then it advances "blocked_until_ms" by "analysis.fundsignal.retry_seconds", not by "run_interval_hours"

  @AC-5 @feature-156
  Scenario: A disabled producer neither runs nor advances the schedule
    Given "analysis.fundsignal.enabled" is false and the schedule is due
    When the producer loop ticks
    Then it does not call "run_once"
    And it does not advance "blocked_until_ms"
    And it does not busy-spin

  @AC-6 @feature-156
  Scenario: A manual scan does not contaminate the scheduled cadence
    Given a completed schedule row with a future "blocked_until_ms"
    When an admin invokes "RunFundamentalsScan" (including a dry_run or an explicit symbols override)
    Then "run_once" executes for that manual request
    But the "analysis.fundsignal_schedule" row's "blocked_until_ms" is unchanged

  @AC-7 @feature-156
  Scenario: Startup jitter is bounded
    Given "analysis.fundsignal.startup_jitter_seconds" is configured to N
    When the producer loop begins
    Then the one-shot startup delay is a value in the closed interval [0, N] seconds
