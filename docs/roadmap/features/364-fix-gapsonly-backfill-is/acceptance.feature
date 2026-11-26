Feature: fix-gapsonly-backfill-is (bug fix)
  Regression guard for defect report docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md:
  GAPS_ONLY backfill is blind to interior holes and reports COMPLETED.
  "Trading session" = a US-equity regular trading day (weekday, not a US exchange holiday).

  @AC-1 @FR-1 @regression
  Scenario: A GAPS_ONLY backfill fills an interior hole in daily bars
    Given SCHW has daily bars from 2025-11-20 to 2026-03-31 and from 2026-09-28 to 2026-11-25
    And SCHW has no daily bars from 2026-04-01 to 2026-09-25
    When a GAPS_ONLY daily-bar backfill runs for SCHW from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And SCHW has a daily bar for every trading session from 2025-11-20 to 2026-11-25

  @AC-2 @FR-2 @regression
  Scenario: A GAPS_ONLY backfill that cannot fill an interior hole does not report COMPLETED
    Given IDXX has daily bars from 2025-11-20 to 2026-03-31 and from 2026-09-28 to 2026-11-25
    And IDXX has no daily bars from 2026-04-01 to 2026-09-25
    And the vendor returns no bars for IDXX from 2026-04-01 to 2026-09-25
    When a GAPS_ONLY daily-bar backfill runs for IDXX from 2025-11-20 to 2026-11-25
    Then get_backfill_status does not report the job as COMPLETED with no missing sessions
    And the job's result identifies 2026-04-01 to 2026-09-25 as still missing for IDXX

  @AC-3 @FR-3
  Scenario: A GAPS_ONLY backfill over a fully covered range fetches nothing
    Given RLI has a daily bar for every trading session from 2025-11-20 to 2026-11-25
    When a GAPS_ONLY daily-bar backfill runs for RLI from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And get_backfill_status reports bars_processed 0 for the job

  # Added at /sdd-spec 2026-11-26 from the approved design (C-15): the operator-accepted head-gap
  # carve-out (O-1, K = 730 days) and the two consumer-surface cases of the new `incomplete` outcome.

  @AC-4 @FR-2
  Scenario: A GAPS_ONLY backfill whose only unfilled range is a head gap with no earlier bars completes
    Given NEWCO has daily bars from 2026-06-01 to 2026-11-25 and no daily bar in the 730 days before 2026-06-01
    And the vendor returns no bars for NEWCO before 2026-06-01
    When a GAPS_ONLY daily-bar backfill runs for NEWCO from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And get_backfill_status lists no "incomplete" outcome for NEWCO

  @AC-5 @FR-2
  Scenario: The Backtests card reports an unfillable interior hole as vendor data missing, not as a retryable partial
    Given the backfill for "LYFT" triggered from the Backtests card ended PARTIAL with every chunk completed
    And its only per-symbol result is "LYFT" with outcome "incomplete"
    When the Backtests card is shown
    Then it shows "Backfill finished: vendor has no bars for some sessions of LYFT"
    And it offers "Re-run backtest"
    And when "Re-run backtest" returns insufficient data with the same gap, the card shows "No vendor data for" that gap and no "Backfill missing data" action

  @AC-6 @FR-2
  Scenario: get_backfill_status reports the still-missing sessions as an incomplete outcome
    Given a GAPS_ONLY daily-bar backfill for IDXX ended PARTIAL because 2026-04-01 to 2026-09-25 is still missing
    When get_backfill_status is called for the job
    Then the result lists "IDXX" with outcome "incomplete" and a reason containing "2026-04-01..2026-09-25"
    And "IDXX" is not in failed_symbols
