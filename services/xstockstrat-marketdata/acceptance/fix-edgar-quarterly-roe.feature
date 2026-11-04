# Promoted from docs/roadmap/features/222-fix-edgar-quarterly-roe/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-222` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata — EDGAR quarterly ROE is trailing-twelve-month
  Regression guard for defect report docs/reports/2026-10-06-edgar-quarterly-roe-not-annualized-defect.md (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-06-edgar-quarterly-roe-not-annualized-defect.md):
  EDGAR quarterly ROE is a single-quarter ratio, not annualized, while P/E on the same row is TTM.

  @AC-1 @regression @feature-222
  Scenario: A quarterly EDGAR period reports ROE on a trailing-twelve-month basis
    Given AXP quarterly net income of 2,500M, 2,600M, 2,700M and 2,885M for the last four quarters
    And AXP stockholders' equity of 30,264M at the Q2-2026 period end
    When the Q2-2026 quarterly period is built from EDGAR company facts
    Then its roe is 10,685 / 30,264 ≈ 0.353
    And it is not the single-quarter ratio 2,885 / 30,264 ≈ 0.095

  @AC-2 @regression @feature-222
  Scenario: The EDGAR snapshot inherits the annualized quarterly ROE
    Given the newest stored AXP period is that Q2-2026 quarterly period
    When GetFundamentals("AXP") is served with snapshot_source = edgar
    Then the snapshot roe equals the period's trailing-twelve-month roe

  @AC-3 @regression @feature-222
  Scenario: Annual periods are unchanged
    Given AXP FY2025 annual net income and year-end equity
    When the FY2025 annual period is built
    Then its roe is annual net income / equity, unchanged from today's derivation
