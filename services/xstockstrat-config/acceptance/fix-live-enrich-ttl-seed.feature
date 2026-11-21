# Promoted from docs/roadmap/features/330-fix-live-enrich-ttl-seed/acceptance.feature (C-16). Verbatim; do not hand-edit.
Feature: fix-live-enrich-ttl-seed (bug fix)
  Regression guard for defect report: seeded live-enrich memo TTL (10s) is below the UI poll (15s).

  # guards: docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md
  @AC-1 @FR-1 @regression @feature-330
  Scenario Outline: the effective live-enrich memo TTL exceeds the 15s UI poll after config migrations
    Given config migration 028 seeded opportunity.live_enrich_ttl_seconds = "10" in namespace "analysis" for <environment>, and the row still holds the seeded '10'
    When all config migrations are applied
    Then the effective opportunity.live_enrich_ttl_seconds for <environment> is "20"
    And it is greater than the 15 second ListOpportunities poll interval

    Examples:
      | environment |
      | staging     |
      | production  |
