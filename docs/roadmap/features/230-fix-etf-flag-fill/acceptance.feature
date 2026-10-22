Feature: fix-etf-flag-fill (bug fix)
  Regression guard for defect report docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md:
  the background ETF-flag fill never labels an ETF and the cause is invisible at Info level.
  Narrowed 2026-10-22 (operator): the FMP boot-seed over-count is fixed and tested by
  255-fix-marketdata-fundamentals-cache (@AC-3 there); 230 lands after 255. 215 @AC-14 must keep passing.

  @AC-2 @FR-1 @regression
  Scenario: An ETF missed once is labelled on a later call once budget allows
    Given marketdata.fmp.daily_request_cap is 250
    And today's marketdata.fundamentals holds 210 rows with source "finnhub" or "edgar" and 5 rows with source "fmp"
    And xstockstrat-marketdata has started and seeded its FMP day budget
    And the ETF-flag cache has no entry for "SCHD"
    And the FMP profile for "SCHD" reports isEtf true
    When GetEtfFlags is called for "SCHD" and the background filler drains the queue
    And GetEtfFlags is called for "SCHD" again
    Then the second response has is_etf set to true

  @AC-3 @FR-2 @regression
  Scenario: A skipped or failed fill is visible at Info level without raw error text
    Given the ETF-flag fill gate is closed, or the FMP profile fetch returns an error whose text contains "apikey="
    When the background filler processes "SCHD"
    Then marketdata emits a log record at Info level or higher naming the symbol and the reason ("gate closed" with used/cap, or the fetch error class)
    And the log record does not contain the raw error text or "apikey="
    And repeated skips within the one-minute rate-limit window emit at most one such record
