# Promoted from docs/roadmap/features/348-fix-edgar-historical-fundamentals/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-348` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-edgar-historical-fundamentals (bug fix)
  Regression guard for docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md.
  Values come from Oracle's SEC companyfacts (CIK0001341439): the 10-Q filed 2025-09-10 for the
  quarter ended 2025-08-31 and the 10-Q filed 2026-09-11 for the quarter ended 2026-08-31 both carry
  fy 2026, fp Q1.

  # guards: docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md
  @AC-1 @FR-1 @FR-2 @FR-3 @regression @feature-348
  Scenario: two filings with the same fy/fp a year apart yield two periods with their own values
    Given Oracle's SEC companyfacts, in which the 10-Q filed 2025-09-10 and the 10-Q filed 2026-09-11 both carry fy 2026 and fp "Q1"
    When the historical fundamentals for "ORCL" are derived
    Then there is a quarterly period with period_end 2025-08-31, filed_date 2025-09-10, net income 2927000000 and shareholders' equity 24154000000
    And there is a quarterly period with period_end 2026-08-31, filed_date 2026-09-11, net income 4760000000 and shareholders' equity 66772000000

  @AC-2 @FR-2 @feature-348
  Scenario: no derived period ends after it was filed
    Given Oracle's SEC companyfacts, whose cover-page share count for the 10-Q filed 2026-09-11 is dated 2026-09-07
    When the historical fundamentals for "ORCL" are derived
    Then the quarterly period filed 2026-09-11 has period_end 2026-08-31
    And no derived period has a period_end later than its filed_date

  @AC-3 @FR-4 @feature-348
  Scenario: each period has its own deterministic label
    Given Oracle's SEC companyfacts, in which the 10-Q filed 2025-09-10 and the 10-Q filed 2026-09-11 both carry fy 2026 and fp "Q1"
    When the historical fundamentals for "ORCL" are derived twice
    Then the quarterly period ending 2025-08-31 is labelled "Q1-2026" and the quarterly period ending 2026-08-31 is labelled "Q1-2027"
    And no two derived periods of the same period type share a fiscal_period label
    And both derivations produce the same label for every period

  # guards: docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md
  @AC-4 @FR-6 @regression @feature-348
  Scenario: a point-in-time read does not return figures filed on or after the as-of date
    Given the stored "ORCL" periods were derived from Oracle's SEC companyfacts after the fix
    When GetHistoricalFundamentals is called for "ORCL" as of 2025-10-01
    Then the newest quarterly period returned has period_end 2025-08-31 and shareholders' equity 24154000000
    And every returned period has a filed_date before 2025-10-01
    When GetHistoricalFundamentals is called for "ORCL" as of 2025-09-10
    Then the quarterly period with period_end 2025-08-31 is NOT returned
    When GetHistoricalFundamentals is called for "ORCL" as of 2025-09-11
    Then the quarterly period with period_end 2025-08-31 IS returned with filed_date 2025-09-10

  @AC-5 @FR-5 @feature-348
  Scenario: a collided row stored before the fix is replaced by the re-derive
    Given a row stored before the fix for "ORCL" labelled "Q1-2026" with filed_date 2025-09-10, period_end 2026-09-07 and shareholders' equity 66772000000
    When the fix is deployed and the fundamentals backfill re-derives "ORCL"
    Then every stored "ORCL" row carries derivation version 3
    And no stored "ORCL" row has a period_end later than its filed_date
    And no stored "ORCL" row has period_end 2026-09-07
    And the stored row labelled "Q1-2026" has period_end 2025-08-31, filed_date 2025-09-10 and shareholders' equity 24154000000
    And the stored row labelled "Q1-2027" has period_end 2026-08-31, filed_date 2026-09-11 and shareholders' equity 66772000000

  @AC-6 @FR-7 @feature-348
  Scenario: the EDGAR snapshot serves the newest period under the corrected identity
    Given the stored "ORCL" periods were derived from Oracle's SEC companyfacts after the fix
    And the snapshot source is "edgar"
    And an EDGAR snapshot for "ORCL" was cached before the fundamentals backfill replaced a stored "ORCL" row
    When GetFundamentals is called for "ORCL"
    Then the snapshot cached before the replace is not served
    And the snapshot is built from the quarterly period with period_end 2026-08-31, filed_date 2026-09-11 and shareholders' equity 66772000000

  @AC-7 @FR-8 @feature-348
  Scenario: the operator audit passes only when every pass condition holds
    Given a staging database on which the post-deploy repair has finished
    And the lane's fundamentals.history.backfill.period_types reads "both"
    When the operator runs the documented audit
    Then the audit passes only if the count of rows with period_end later than filed_date is 0
    And only if every row below derivation version 3 belongs to a symbol the repair reported failed
    And only if no two rows of one symbol and period type share a period_end
    And only if the audit plans no delete and no insert for every symbol the repair did not report failed
    And the audit reports, per price-join column, how many rows went from a value to null between the pre-repair and post-repair rows

  @AC-8 @FR-1 @FR-5 @feature-348
  Scenario: the repair restores both collided periods, and a later ranged backfill adds nothing outside its range
    Given a row stored before the fix for "ORCL" labelled "Q1-2026" with filed_date 2025-09-10 and period_end 2026-09-07 at derivation version 2
    When the fundamentals backfill runs for "ORCL" with the range 2016-01-01..2026-06-30
    Then the stored quarterly row with period_end 2025-08-31 has filed_date 2025-09-10
    And the stored quarterly row with period_end 2026-08-31 has filed_date 2026-09-11
    Given every stored "ORCL" row carries derivation version 3 and none has a period_end before 2020-01-01
    When the fundamentals backfill runs for "ORCL" with the range 2026-01-01..2026-06-30
    Then no "ORCL" row with a period_end before 2026-01-01 or after 2026-06-30 is added, changed or removed

  @AC-9 @FR-5 @feature-348
  Scenario: a ticker that now resolves to another filer fails the symbol without a write
    Given stored "ORCL" rows with net income 2927000000 and shareholders' equity 24154000000
    And the periods derived for the ticker "ORCL" hold net income 100000000 and shareholders' equity 900000000 and no value equal to a stored one
    When the fundamentals backfill runs for "ORCL"
    Then "ORCL" is reported in failed_symbols
    And no stored "ORCL" row is added, changed or removed

  @AC-10 @FR-4 @feature-348
  Scenario: a fiscal year end moved later within one calendar year leaves the later-ending periods out
    Given a filer's SEC companyfacts with a 10-K for the year ended 2023-06-30, 10-Qs for the quarters ended 2023-03-31 and 2023-09-30, and a 10-KT for the six months ended 2023-12-31
    When the historical fundamentals for that filer are derived by a fundamentals backfill
    Then the annual period ended 2023-06-30 is labelled "FY2023" and the quarterly period ended 2023-03-31 is labelled "Q3-2023"
    And the periods ended 2023-09-30 and 2023-12-31 are left out of the derived set
    And marketdata.backfill.periods_left_out counts 2 with reason "label_collision"
    And no two derived periods of the same period type share a fiscal_period label

  @AC-11 @FR-5 @FR-6 @feature-348
  Scenario: a replaced row is priced at its own filing date from its own statement
    Given a row stored before the fix for "ORCL" labelled "Q1-2026" with filed_date 2025-09-10, period_end 2026-09-07, price 310.25, dividend_yield 0.0065 and pb_ratio 13.1
    When the fundamentals backfill replaces that row with the periods ended 2025-08-31 (filed 2025-09-10) and 2026-08-31 (filed 2026-09-11)
    Then the row for the period ended 2025-08-31 keeps price 310.25 and dividend_yield 0.0065, the values stored under the same filed_date
    And its market_cap, pe_ratio and pb_ratio are computed from price 310.25 and its own statement (shareholders' equity 24154000000), not carried from the stored row
    And the row for the period ended 2026-08-31 takes its price from the daily bar at 2026-09-11, with nothing carried from a row filed on another date
    And a price-join column of a replacement row is left unset when no daily bar exists within 14 days before its filed_date, when its trailing-12-month dividend window predates the dividend fetch, or when its statement lacks the input
