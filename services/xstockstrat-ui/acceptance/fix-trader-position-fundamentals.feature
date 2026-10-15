# Promoted from docs/roadmap/features/220-fix-trader-position-fundamentals/acceptance.feature (Constitution C-16).
# Provenance: @feature-220.

Feature: fix-trader-position-fundamentals — trader position Fundamentals card never loads forever
  Regression guard: the Fundamentals card on the trader position page must resolve to the error state
  when the GetFundamentals call stalls.

  @AC-1 @regression @feature-220
  Scenario: A stalled fundamentals request resolves to the error state instead of loading forever
    Given a trader viewing the position page for "AXP"
    And the GetFundamentals call through the trader BFF never responds
    When the BFF's bounded deadline for GetFundamentals elapses
    Then the Fundamentals card no longer shows "Loading fundamentals…"
    And it shows "No fundamentals data for AXP" with the deadline-exceeded reason
