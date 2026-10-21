Feature: fix-fundsignal-emit-accounting (bug fix)
  Regression guard for docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md:
  a failed fundamentals emit burns the day's claim; a failed fetch chunk vanishes from a "completed" run.

  @AC-1 @regression
  Scenario: A symbol whose emit failed is emitted on the next same-day run
    Given the fundamentals producer scores "AAPL" at 0.85 with source "fundamentals" on 2026-10-21
    And IngestSignal fails with UNAVAILABLE on the first run
    When run_once runs with force false, and then runs again with IngestSignal healthy on 2026-10-21
    Then IngestSignal is called for "AAPL" on the second run
    And the fundsignal_emitted row for ("AAPL", "fundamentals", 2026-10-21) carries the signal_id ingest returned

  @AC-2 @regression
  Scenario: signals_emitted counts only signals ingest accepted
    Given the producer scores "AAPL" at 0.85 and "MSFT" at 0.90
    And IngestSignal succeeds for "MSFT" and fails with UNAVAILABLE for "AAPL"
    When run_once runs with force false
    Then the finished run records signals_emitted 1

  @AC-3 @regression
  Scenario: A cycle aborted by a system-write rejection leaves no orphan claim
    Given the producer scores "AAPL" at 0.85
    And IngestSignal fails with NOT_FOUND for "AAPL"
    When run_once runs with force false
    Then the run is aborted
    And no fundsignal_emitted row without a signal_id exists for ("AAPL", "fundamentals", 2026-10-21)

  @AC-4 @regression
  Scenario: Symbols from a failed fetch chunk are reported, not silently dropped
    Given the producer's universe is 60 symbols and its daily call budget is 200
    And the first GetFundamentalsMulti chunk of 50 symbols fails with UNAVAILABLE
    When run_once runs with force false
    Then the finished run's status is not "completed"
    And the run's deferred count is 50
