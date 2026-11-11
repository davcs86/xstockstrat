Feature: fix-live-enrich-ttl-seed (bug fix)
  Regression guard for defect report: seeded live-enrich memo TTL (10s) is below the UI poll (15s).

  # guards: docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md
  @AC-1 @regression
  Scenario Outline: the effective live-enrich memo TTL exceeds the 15s UI poll after config migrations
    Given config migration 028 seeded opportunity.live_enrich_ttl_seconds = "10" in namespace "analysis" for <environment>
    When all config migrations are applied
    Then the effective opportunity.live_enrich_ttl_seconds for <environment> is "20"
    And it is greater than the 15 second ListOpportunities poll interval

    Examples:
      | environment |
      | staging     |
      | production  |

  # guards: docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md
  @AC-2 @regression
  Scenario: a warm 15s re-poll of ListOpportunities is served from the live-enrich memo
    Given the migrated config is applied and a ListOpportunities call has just enriched its symbols live
    When the UI re-polls ListOpportunities 15 seconds later
    Then that re-poll issues no BatchGetLatestPrice for the memoized symbols
