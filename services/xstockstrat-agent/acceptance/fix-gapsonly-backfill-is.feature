# Promoted from docs/roadmap/features/364-fix-gapsonly-backfill-is/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-364` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-gapsonly-backfill-is (agent)
  What the get_backfill_status MCP tool reports for a GAPS_ONLY backfill with still-missing sessions.

  @AC-6 @FR-2 @feature-364
  Scenario: get_backfill_status reports the still-missing sessions as an incomplete outcome
    Given a GAPS_ONLY daily-bar backfill for IDXX ended PARTIAL because 2026-04-01 to 2026-09-25 is still missing
    When get_backfill_status is called for the job
    Then the result lists "IDXX" with outcome "incomplete" and a reason containing "2026-04-01..2026-09-25"
    And "IDXX" is not in failed_symbols
