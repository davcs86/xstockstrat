Feature: fix-gapsonly-backfill-is (bug fix)
  Regression guard for defect report docs/reports/2026-11-25-gaps-only-backfill-blind-to-interior-holes-defect.md:
  GAPS_ONLY backfill is blind to interior holes and reports COMPLETED.

  @AC-1 @regression
  Scenario: A GAPS_ONLY backfill fills an interior hole in daily bars
    Given SCHW has daily bars from 2025-11-20 to 2026-03-31 and from 2026-09-28 to 2026-11-25
    And SCHW has no daily bars from 2026-04-01 to 2026-09-25
    When a GAPS_ONLY daily-bar backfill runs for SCHW from 2025-11-20 to 2026-11-25
    Then the job fetches the missing sessions from 2026-04-01 to 2026-09-25
    And SCHW has a daily bar for every trading session from 2025-11-20 to 2026-11-25
