# Promoted from docs/roadmap/features/365-fix-a-filtered-listopportunities/acceptance.feature at
# archive time (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-365` tag. Durable business rule xstockstrat-analysis guarantees for ListOpportunities:
# a filtered read that matches no rows, on a user whose queue holds unexpired rows, is a plain empty
# page and never kicks a background recompute. A rule enters only by promotion from a reviewed
# feature acceptance.feature, never by hand-authoring.

Feature: fix-a-filtered-listopportunities (analysis-service guarantees)
  Regression guard for defect report docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md:
  a filtered ListOpportunities read with no matches kicks a full recompute.

  @AC-1 @regression @feature-365
  Scenario: A filtered read with no matches leaves a fresh queue untouched
    Given a user's opportunity queue holds 424 rows valid until 2026-11-28T05:00Z
    And no row is muted, data-unavailable, fundamentals-unavailable or formula-unreadable
    When the user lists opportunities with min_conviction 1.01
    Then the response is an empty page with computing false
    And no background recompute starts for that user
    And the queue rows keep valid_until 2026-11-28T05:00Z

  @AC-2 @regression @feature-365
  Scenario: A symbol-filtered read for a symbol absent from a fresh queue does not recompute
    Given a user's opportunity queue holds unexpired rows and none for SCKT
    When the user lists opportunities with symbol SCKT
    Then the response is an empty page
    And no background recompute starts for that user
