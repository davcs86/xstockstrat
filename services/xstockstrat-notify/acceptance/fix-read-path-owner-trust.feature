# Promoted from docs/roadmap/features/312-fix-read-path-owner-trust/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-312` tag.
# Durable business rules notify already guarantees; a rule enters only by promotion from a reviewed acceptance.feature.

Feature: xstockstrat-notify - ListAlerts scopes ownership to the trusted x-user-id header
  ListAlerts takes the owner from x-user-id metadata only; a body userId never widens or redirects the read.

  # guards: docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md
  @AC-3 @regression @feature-312
  Scenario: ListAlerts without x-user-id is rejected and a body userId is ignored
    Given alerts targeted to users "user-a" and "user-b"
    When NotifyService.ListAlerts is called over mTLS with no x-user-id metadata
    Then the call is rejected with INVALID_ARGUMENT or UNAUTHENTICATED
    And when it is called with x-user-id "user-a" and body userId "user-b"
    Then no alert targeted to "user-b" is returned
