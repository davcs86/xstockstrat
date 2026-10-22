Feature: fix-etf-flag-fill (bug fix)
  Regression guard for defect report docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md:
  the background ETF-flag fill never labels an ETF and the cause is invisible at Info level.

  @AC-1 @FR-1 @regression
  Scenario: The FMP budget boot seed counts only FMP-sourced fundamentals rows
    Given marketdata.fmp.daily_request_cap is 250
    And today's marketdata.fundamentals holds 210 rows with source "finnhub" or "edgar" and 5 rows with source "fmp"
    When xstockstrat-marketdata starts and seeds its FMP day budget
    Then the seeded FMP usage is 5
    And the ETF-flag fill gate is open (5 is below the 200-call 80% mark)

  @AC-2 @FR-1 @regression
  Scenario: An ETF missed once is labeled on a later call
    Given the ETF-flag cache has no entry for "SCHD"
    And the FMP profile for "SCHD" reports isEtf true
    And the fill gate is open
    When GetEtfFlags is called for "SCHD" and the background filler drains the queue
    And GetEtfFlags is called for "SCHD" again
    Then the second response has is_etf set to true

  @AC-3 @FR-2 @regression
  Scenario: A skipped or failed fill is visible at Info level
    Given the ETF-flag fill gate is closed, or the FMP profile fetch returns an error
    When the background filler processes "SCHD"
    Then marketdata emits a log record at Info level or higher naming the symbol and the reason ("gate closed" with used/cap, or the fetch error)
    And repeated skips within one minute emit at most one such record
