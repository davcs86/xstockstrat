Feature: fix-stored-edgar-periods (bug fix)
  Regression guard for defect report docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md:
  Stored EDGAR periods still carry total-liabilities D/E after feature 211's financial-debt D/E launched.

  @AC-1 @regression
  Scenario: Stored AXP periods carry financial-debt D/E after re-derivation
    Given AXP historical EDGAR periods stored before feature 211 with total-liabilities D/E ≈ 8.8
    When the stored periods are re-derived with the current EDGAR period builder
    Then the AXP Q2-2026 period's debt_to_equity is total_debt / equity ≈ 1.73
    And it is below the fundamentals formula's de_bad of 2.0

  @AC-2 @regression
  Scenario: The EDGAR snapshot reflects the re-derived period
    Given the AXP periods have been re-derived
    When GetFundamentals("AXP") is served with snapshot_source = edgar
    Then the snapshot debt_to_equity equals the re-derived Q2-2026 period's value
    And no cached snapshot row with the old total-liabilities ratio is served
