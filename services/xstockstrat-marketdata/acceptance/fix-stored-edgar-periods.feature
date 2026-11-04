# Promoted from docs/roadmap/features/223-fix-stored-edgar-periods/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-223` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata — stored EDGAR periods are re-derived to the current D/E convention
  Stored EDGAR periods that predate feature 211's financial-debt D/E are upgraded in place, and the
  EDGAR snapshot served from them reflects the re-derived values rather than a stale cached row.

  @AC-1 @regression @feature-223
  Scenario: Stored AXP periods carry financial-debt D/E after re-derivation
    Given AXP historical EDGAR periods stored before feature 211 with total-liabilities D/E ≈ 8.8
    When the stored periods are re-derived with the current EDGAR period builder
    Then the AXP Q2-2026 period's debt_to_equity is total_debt / equity ≈ 1.73
    And it is below the fundamentals formula's de_bad of 2.0

  @AC-2 @regression @feature-223
  Scenario: The EDGAR snapshot reflects the re-derived period
    Given the AXP periods have been re-derived
    When GetFundamentals("AXP") is served with snapshot_source = edgar
    Then the snapshot debt_to_equity equals the re-derived Q2-2026 period's value
    And no cached snapshot row with the old total-liabilities ratio is served
