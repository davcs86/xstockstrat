# Promoted from docs/roadmap/features/364-fix-gapsonly-backfill-is/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-364` tag.
# Durable business rules xstockstrat-ingest already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-gapsonly-backfill-is (ingest)
  GAPS_ONLY backfill detects interior holes and never reports COMPLETED while sessions remain missing.
  "Trading session" = a US-equity regular trading day (weekday, not a US exchange holiday).

  @AC-1 @FR-1 @regression @feature-364
  Scenario: A GAPS_ONLY backfill fills an interior hole in daily bars
    Given SCHW has daily bars from 2025-11-20 to 2026-03-31 and from 2026-09-28 to 2026-11-25
    And SCHW has no daily bars from 2026-04-01 to 2026-09-25
    When a GAPS_ONLY daily-bar backfill runs for SCHW from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And SCHW has a daily bar for every trading session from 2025-11-20 to 2026-11-25

  @AC-2 @FR-2 @regression @feature-364
  Scenario: A GAPS_ONLY backfill that cannot fill an interior hole does not report COMPLETED
    Given IDXX has daily bars from 2025-11-20 to 2026-03-31 and from 2026-09-28 to 2026-11-25
    And IDXX has no daily bars from 2026-04-01 to 2026-09-25
    And the vendor returns no bars for IDXX from 2026-04-01 to 2026-09-25
    When a GAPS_ONLY daily-bar backfill runs for IDXX from 2025-11-20 to 2026-11-25
    Then get_backfill_status does not report the job as COMPLETED with no missing sessions
    And the job's result identifies 2026-04-01 to 2026-09-25 as still missing for IDXX

  @AC-3 @FR-3 @feature-364
  Scenario: A GAPS_ONLY backfill over a fully covered range fetches nothing
    Given RLI has a daily bar for every trading session from 2025-11-20 to 2026-11-25
    When a GAPS_ONLY daily-bar backfill runs for RLI from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And get_backfill_status reports bars_processed 0 for the job

  @AC-4 @FR-2 @feature-364
  Scenario: A GAPS_ONLY backfill whose only unfilled range is a head gap with no earlier bars completes
    Given NEWCO has daily bars from 2026-06-01 to 2026-11-25 and no daily bar in the 730 days before 2026-06-01
    And the vendor returns no bars for NEWCO before 2026-06-01
    When a GAPS_ONLY daily-bar backfill runs for NEWCO from 2025-11-20 to 2026-11-25
    Then the job ends COMPLETED
    And get_backfill_status lists no "incomplete" outcome for NEWCO
