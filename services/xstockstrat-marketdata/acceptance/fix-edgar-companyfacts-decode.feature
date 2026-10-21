# Promoted from docs/roadmap/features/253-fix-edgar-companyfacts-decode/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-253` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata — EDGAR companyfacts decode tolerates either JSON type for cik
  Regression guard for docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md:
  EDGAR companyfacts decode fails when SEC returns `cik` as a string.

  @AC-1 @regression @feature-253
  Scenario Outline: Companyfacts decodes whichever JSON type SEC uses for cik
    Given SEC companyfacts for "CRCL" carries "cik" as <cik> and a NetIncomeLoss fact for FY2025 FY
    When marketdata fetches the historical fundamentals for "CRCL"
    Then the fetch succeeds and returns the FY2025 annual period

    Examples:
      | cik            |
      | "0001876042"   |
      | 1876042        |
