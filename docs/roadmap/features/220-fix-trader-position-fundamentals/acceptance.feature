Feature: fix-trader-position-fundamentals (bug fix)
  Regression guard for defect report docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md:
  Trader position Fundamentals card stays on "Loading fundamentals…" indefinitely.

  @AC-1 @regression
  Scenario: A stalled fundamentals request resolves to the error state instead of loading forever
    Given a trader viewing the position page for "AXP"
    And the GetFundamentals call through the trader BFF never responds
    When the BFF's bounded deadline for GetFundamentals elapses
    Then the Fundamentals card no longer shows "Loading fundamentals…"
    And it shows "No fundamentals data for AXP" with the deadline-exceeded reason
