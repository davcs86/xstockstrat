# Promoted from docs/roadmap/features/225-private-by-default-enforce-contract/acceptance.feature
# Source: @AC-1, @AC-2, @AC-10, @AC-11 — indicators scenarios
Feature: private-by-default-enforce-contract (indicators)
  Acceptance scenarios for the xstockstrat-indicators service promoted from feature 225.
  Covers the fail-closed identity gate, removal of the analysis formula-read bypass, the unchanged
  non-owner NOT_FOUND, and write paths that no longer touch is_public.

  @AC-1 @FR-1 @feature-225
  Scenario: A headerless owner-scoped call is rejected in indicators
    Given a gRPC call to indicators "ListFormulas" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"
    And no formula rows are returned

  @AC-2 @FR-2 @feature-225
  Scenario: The analysis formula-read bypass is gone
    Given a formula "f-1" owned by user "u-1"
    And a call to indicators "GetFormula" for "f-1" with "x-user-id: u-2", "x-internal-caller: analysis" and peer SAN "xstockstrat-analysis"
    When the call is served
    Then it fails with status "NOT_FOUND"

  @AC-10 @FR-1 @feature-225
  Scenario: An identified non-owner keeps the non-owner result
    Given a formula "f-1" owned by user "u-1"
    When user "u-2" calls indicators "GetFormula" for "f-1" with "x-user-id: u-2"
    Then it fails with status "NOT_FOUND"

  @AC-11 @FR-4 @feature-225
  Scenario: indicators no longer writes is_public, so the column can be dropped later
    Given a test schema where "indicators.formulas" has no "is_public" column
    When the indicators write statements used by RegisterFormula, UpdateFormula, the startup formula seed upsert and template instantiation are executed against it
    Then all four writes succeed
