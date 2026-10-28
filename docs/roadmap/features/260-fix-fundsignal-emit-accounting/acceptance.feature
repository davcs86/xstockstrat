Feature: fix-fundsignal-emit-accounting (bug fix)
  Regression guard for docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md:
  a failed fundamentals emit burns the day's claim; a failed fetch chunk vanishes from a "completed" run.

  @AC-1 @FR-1 @regression
  Scenario: A symbol whose emit failed is emitted on the next same-day run
    Given the fundamentals producer scores "AAPL" at 0.85 with source "fundamentals" on 2026-10-21
    And IngestSignal fails with UNAVAILABLE on the first run
    When run_once runs with force false, and then runs again with IngestSignal healthy on 2026-10-21
    Then IngestSignal is called for "AAPL" on the second run
    And the fundsignal_emitted row for ("AAPL", "fundamentals", 2026-10-21) carries the signal_id ingest returned

  @AC-2 @FR-2 @regression
  Scenario: signals_emitted counts only signals ingest accepted
    Given the producer scores "AAPL" at 0.85 and "MSFT" at 0.90
    And IngestSignal succeeds for "MSFT" and fails with UNAVAILABLE for "AAPL"
    When run_once runs with force false
    Then the finished run records signals_emitted 1

  @AC-3 @FR-3 @regression
  Scenario: A cycle aborted by a system-write rejection leaves no orphan claim
    Given the producer scores "AAPL" at 0.85
    And IngestSignal fails with NOT_FOUND for "AAPL"
    When run_once runs with force false
    Then the run is aborted
    And no fundsignal_emitted row without a signal_id exists for ("AAPL", "fundamentals", 2026-10-21)

  @AC-4 @FR-4 @regression
  Scenario: Symbols from a failed fetch chunk are reported, not silently dropped
    Given the producer's universe is 60 symbols and its daily call budget is 200
    And the first GetFundamentalsMulti chunk of 50 symbols fails with UNAVAILABLE
    When run_once runs with force false
    Then the finished run's status is "partial"
    And the run's deferred_count is 50
    And the run's symbols_processed is 10

  @AC-5 @FR-3 @regression
  Scenario: A cycle abort keeps the confirmed rows of symbols emitted before it
    The producer emits in sorted symbol order, so "AAPL" is processed before "MSFT".

    Given the producer scores "AAPL" at 0.85 and "MSFT" at 0.90
    And IngestSignal accepts "AAPL" and fails with NOT_FOUND for "MSFT"
    When run_once runs with force false
    Then the run is aborted with signals_emitted 1
    And the fundsignal_emitted row for ("AAPL", "fundamentals", 2026-10-21) carries the signal_id ingest returned
    And no fundsignal_emitted row without a signal_id exists for ("MSFT", "fundamentals", 2026-10-21)

  @AC-6 @FR-4 @regression
  Scenario: A failed fetch chunk wins over a budget cutoff in the run status
    Given the producer's universe is 120 symbols and its daily call budget is 2
    And the first GetFundamentalsMulti chunk of 50 symbols fails with UNAVAILABLE
    And the second chunk of 50 symbols succeeds
    When run_once runs with force false
    Then the finished run's status is "partial"
    And the run's deferred_count is 70
    And the run's symbols_processed is 50

  @AC-7 @FR-1 @regression
  Scenario: Symbols confirmed earlier the same day are skipped with zero fetch calls
    Given fundsignal_emitted rows carrying a signal_id exist for "AAPL" and "MSFT" with source "fundamentals" on 2026-10-21
    When run_once runs with force false over the universe "AAPL", "MSFT" on 2026-10-21
    Then GetFundamentalsMulti is called 0 times
    And IngestSignal is not called
    And the finished run records signals_emitted 0

  @AC-8 @FR-1 @FR-2
  Scenario: A non-force retry after a lost IngestSignal response resends the same signal and counts the dedup
    Ingest absorbs the retry only while ingest.signals.dedup_window_hours > 0 and the conviction is
    unchanged between attempts. A marketdata cache refresh that changes the score, or a window of 0,
    lets ingest store a second row.

    Given the producer scores "AAPL" at 0.85 and "MSFT" at 0.90 with source "fundamentals" on 2026-10-21
    And analysis.fundsignal.valid_days is 90
    And on the first run IngestSignal accepts "MSFT" and fails with UNAVAILABLE for "AAPL" after ingest committed the signal
    When run_once runs with force false, and then runs again on 2026-10-21 with IngestSignal returning the committed signal_id with deduplicated true for "AAPL"
    Then both IngestSignal requests for "AAPL" carry the same direction and conviction
    And both carry valid_until 2027-01-19T00:00:00Z
    And the second run records signals_emitted 1
    And the fundsignal_emitted row for ("AAPL", "fundamentals", 2026-10-21) carries the returned signal_id

  @AC-9 @FR-1
  Scenario: A one-symbol retry keeps the day's cross-sectional direction
    Cuts are computed over the day's stored scores plus the run's own scores. The same day-wide cuts
    apply to a budget_deferred resume and to a non-force override_symbols scan. A retry's direction can
    still flip at a cut boundary when min_conviction_to_emit > 0 or some symbols failed scoring, because
    the stored rows are not the first run's full score set.

    Given fundsignal_emitted rows carrying a signal_id exist on 2026-10-21 for "MSFT" at 0.90, "NVDA" at 0.70 and "GOOG" at 0.50
    And the buy quantile is 0.80 and the sell quantile is 0.20
    And "AAPL" scores 0.10 and has no fundsignal_emitted row on 2026-10-21
    When run_once runs with force false over the universe "AAPL", "GOOG", "MSFT", "NVDA"
    Then IngestSignal is called once, for "AAPL", with direction "sell"

  @AC-10 @FR-1
  Scenario: A force run re-emits with a validity anchored at the run time, not the run date
    Pins the anchor asymmetry: date-anchoring force runs would make a same-day force re-emit an
    ingest dedup no-op.

    Given a fundsignal_emitted row carrying a signal_id exists for ("AAPL", "fundamentals", 2026-10-21)
    And analysis.fundsignal.valid_days is 90
    When run_once runs with force true at 2026-10-21T15:30:00Z
    Then IngestSignal is called for "AAPL"
    And its valid_until is 2027-01-19T15:30:00Z, not 2027-01-19T00:00:00Z
