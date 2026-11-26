Feature: fix-a-filtered-listopportunities (bug fix)
  Regression guard for defect report docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md:
  a filtered ListOpportunities read with no matches kicks a full recompute.

  @AC-1 @FR-1 @regression
  Scenario: A filtered read with no matches leaves a fresh queue untouched
    Given a user's opportunity queue holds 424 rows valid until 2026-11-28T05:00Z
    And no row is muted, data-unavailable, fundamentals-unavailable or formula-unreadable
    When the user lists opportunities with min_conviction 1.01
    Then the response is an empty page with computing false
    And no background recompute starts for that user
    And the queue rows keep valid_until 2026-11-28T05:00Z

  @AC-2 @FR-1 @regression
  Scenario: A symbol-filtered read for a symbol absent from a fresh queue does not recompute
    Given a user's opportunity queue holds 424 rows valid until 2026-11-28T05:00Z and none for SCKT
    When the user lists opportunities with symbol SCKT
    Then the response is an empty page with computing false
    And the queue rows keep valid_until 2026-11-28T05:00Z

  @AC-3 @FR-2
  Scenario: A cold read with no materialized queue still revalidates in the background
    Given a user has no opportunity rows and no still-fresh empty stamp
    When the user lists opportunities with symbol SCKT
    Then the response is an empty page with computing true
    And once the background full recompute finishes, a follow-up read returns computing false

  @AC-4 @FR-2
  Scenario: A filtered read over an all-stale queue still revalidates in the background
    Given a user's opportunity queue holds 424 rows all valid until 2026-11-25T05:00Z
    And the current time is 2026-11-26T12:00Z
    When the user lists opportunities with min_conviction 1.01
    Then a background full recompute starts for that user
    And the queue rows receive a valid_until later than 2026-11-26T12:00Z
