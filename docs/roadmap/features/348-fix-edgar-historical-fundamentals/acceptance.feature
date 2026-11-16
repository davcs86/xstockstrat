Feature: fix-edgar-historical-fundamentals (bug fix)
  Regression guard for docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md.
  Values come from Oracle's SEC companyfacts (CIK0001341439): the 10-Q filed 2025-09-10 for the
  quarter ended 2025-08-31 and the 10-Q filed 2026-09-11 for the quarter ended 2026-08-31 both carry
  fy 2026, fp Q1.

  # guards: docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md
  @AC-1 @FR-1 @FR-2 @FR-3 @regression
  Scenario: two filings with the same fy/fp a year apart yield two periods with their own values
    Given Oracle's SEC companyfacts, in which the 10-Q filed 2025-09-10 and the 10-Q filed 2026-09-11 both carry fy 2026 and fp "Q1"
    When the historical fundamentals for "ORCL" are derived
    Then there is a quarterly period with period_end 2025-08-31, filed_date 2025-09-10, net income 2927000000 and shareholders' equity 24154000000
    And there is a quarterly period with period_end 2026-08-31, filed_date 2026-09-11, net income 4760000000 and shareholders' equity 66772000000

  @AC-2 @FR-2
  Scenario: no derived period ends after it was filed
    Given Oracle's SEC companyfacts, whose cover-page share count for the 10-Q filed 2026-09-11 is dated 2026-09-07
    When the historical fundamentals for "ORCL" are derived
    Then the quarterly period filed 2026-09-11 has period_end 2026-08-31
    And no derived period has a period_end later than its filed_date

  @AC-3 @FR-4
  Scenario: each period has its own deterministic label
    Given Oracle's SEC companyfacts, in which the 10-Q filed 2025-09-10 and the 10-Q filed 2026-09-11 both carry fy 2026 and fp "Q1"
    When the historical fundamentals for "ORCL" are derived twice
    Then the periods ending 2025-08-31 and 2026-08-31 have different fiscal_period labels
    And no two derived periods of the same period type share a fiscal_period label
    And both derivations produce the same label for every period

  # guards: docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md
  @AC-4 @FR-6 @regression
  Scenario: a point-in-time read does not return figures filed later
    Given the stored "ORCL" periods were derived from Oracle's SEC companyfacts after the fix
    When GetHistoricalFundamentals is called for "ORCL" as of 2025-10-01
    Then the newest quarterly period returned has period_end 2025-08-31 and shareholders' equity 24154000000
    And no returned period has a filed_date after 2025-10-01

  @AC-5 @FR-5
  Scenario: a collided row stored before the fix is replaced by the re-derive
    Given a row stored before the fix for "ORCL" labelled "Q1-2026" with filed_date 2025-09-10, period_end 2026-09-07 and shareholders' equity 66772000000
    When the fix is deployed and the fundamentals backfill re-derives "ORCL"
    Then every stored "ORCL" row carries derivation version 3
    And no stored "ORCL" row has a period_end later than its filed_date
    And the stored quarterly row with period_end 2025-08-31 has shareholders' equity 24154000000
    And the stored quarterly row with period_end 2026-08-31 has filed_date 2026-09-11

  @AC-6 @FR-7
  Scenario: the EDGAR snapshot serves the newest period under the corrected identity
    Given the stored "ORCL" periods were derived from Oracle's SEC companyfacts after the fix
    And the snapshot source is "edgar"
    When GetFundamentals is called for "ORCL"
    Then the snapshot is built from the quarterly period with period_end 2026-08-31 and shareholders' equity 66772000000

  @AC-7 @FR-8
  Scenario: the operator audit passes only when no stored period ends after it was filed
    Given a staging database on which the post-deploy repair has finished
    When the operator runs the documented audit query that counts rows with period_end later than filed_date
    Then the audit passes only if the count is 0
