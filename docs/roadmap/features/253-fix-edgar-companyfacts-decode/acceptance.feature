Feature: fix-edgar-companyfacts-decode (bug fix)
  Regression guard for docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md:
  EDGAR companyfacts decode fails when SEC returns `cik` as a string.

  @AC-1 @regression
  Scenario Outline: Companyfacts decodes whichever JSON type SEC uses for cik
    Given SEC companyfacts for "CRCL" carries "cik" as <cik> and a NetIncomeLoss fact for FY2025 FY
    When marketdata fetches the historical fundamentals for "CRCL"
    Then the fetch succeeds and returns the FY2025 annual period

    Examples:
      | cik            |
      | "0001876042"   |
      | 1876042        |
