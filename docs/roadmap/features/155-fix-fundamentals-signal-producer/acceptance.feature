Feature: fix-fundamentals-signal-producer (bug fix)
  Regression guard for defect 2026-08-25-fundsignal-first-cycle-resets-on-redeploy:
  the fundamentals signal producer must fire its first cycle promptly after startup and
  survive redeploys, instead of sleeping a full interval before the first run.

  @AC-1 @regression
  Scenario: The producer runs its first cycle promptly on startup, not after a full interval
    Given "analysis.fundsignal.enabled" is true and the resolved universe is non-empty
    And the producer process has just started with no prior run recorded today
    When the producer loop begins
    Then it invokes its first "run_once" cycle without first sleeping a full "run_interval_hours"
    And the "fundamentals" signal source becomes registered within the startup window

  @AC-2 @regression
  Scenario: A restart before the interval elapses does not defer the cycle another full interval
    Given a producer previously completed a run recorded in "analysis.fundsignal_runs"
    And the process restarts before "run_interval_hours" has elapsed since that run
    When the producer loop begins
    Then it does not re-arm a fresh full-interval sleep that would defer the next cycle past the
      originally-scheduled time
    And a due cycle (last run older than the interval) is executed promptly rather than after a
      full fresh interval
