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
    And the job requested 0 bars from the vendor for RLI
