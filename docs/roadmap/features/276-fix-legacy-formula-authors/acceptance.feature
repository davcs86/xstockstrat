Feature: fix-legacy-formula-authors (bug fix)
  Regression guard for the defect report docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md:
  formulas stored under a legacy username author are unreadable by their owner.

  @AC-1 @FR-1 @regression
  Scenario: A formula created before ownership moved to user id is owned by its user id
    Given the formula "31bb8ea6-0f3e-4cf7-8844-ec8294cebf85" is stored with author "davcs86"
    And the user "davcs86" has user id "80880990-2b79-4d85-8761-d8d9102c2efb"
    When the legacy-author fix runs
    Then GetFormula for "31bb8ea6-0f3e-4cf7-8844-ec8294cebf85" returns author "80880990-2b79-4d85-8761-d8d9102c2efb"
    And ListFormulas called as user "80880990-2b79-4d85-8761-d8d9102c2efb" includes it
    And GetFormula and ExecuteFormula called as that user succeed

  @AC-2 @FR-2 @regression
  Scenario: Legacy authors beyond the known staging ids are found, including soft-deleted rows
    Given a formula "f-live" (id "aaaaaaaa-0000-4000-8000-000000000001") stored with author "alice" and a soft-deleted formula "f-gone" (id "aaaaaaaa-0000-4000-8000-000000000002") stored with author "alice"
    And the user "alice" has user id "11111111-1111-4111-8111-111111111111"
    When the legacy-author fix runs
    Then both "f-live" and "f-gone" have author "11111111-1111-4111-8111-111111111111"

  @AC-3 @FR-3
  Scenario: An author that maps to no user is left unchanged and reported
    Given the formula "f-orphan" is stored with author "ghost" and no user "ghost" exists
    When the legacy-author fix runs
    Then the formula "f-orphan" still has author "ghost"
    And the run report lists "f-orphan" with author "ghost" as unmappable
    And ListFormulas called as any user does not include "f-orphan"

  @AC-4 @FR-4
  Scenario: A second run changes nothing and non-legacy formulas are untouched
    Given the legacy-author fix has already run once
    And the formula "f-system" is stored with the system author and "f-owned" is stored with a user id author
    When the legacy-author fix runs again
    Then the run report shows 0 rewritten
    And "f-system" and "f-owned" keep their authors and their updated timestamps

  @AC-5 @FR-5
  Scenario: The operator can count legacy authors without mutating data
    Given 2 formulas with mappable legacy authors, 1 with an unmappable author and 3 with user id or system authors exist
    When the legacy-author fix runs in report-only mode
    Then the report shows 2 rewritable, 1 unmappable and 3 clean
    And no formula author has changed

  @AC-6 @FR-6 @regression
  Scenario: Ownership repair does not widen read access
    Given the formula "31bb8ea6-0f3e-4cf7-8844-ec8294cebf85" has been repaired to author "80880990-2b79-4d85-8761-d8d9102c2efb"
    When ExecuteFormula is called for it as a different non-admin user "22222222-2222-4222-8222-222222222222"
    Then the call returns NOT_FOUND

  @AC-7 @FR-3
  Scenario: An author that maps to more than one user is left unchanged and reported
    Given the formula "f-ambiguous" is stored with author "sam" and two users match the username "sam"
    When the legacy-author fix runs
    Then the formula "f-ambiguous" still has author "sam"
    And the run report lists "f-ambiguous" with author "sam" as ambiguous

  @AC-8 @FR-7
  Scenario: A row written between detection and rewrite is not lost or overwritten
    Given the formula "bbbbbbbb-0000-4000-8000-000000000001" is stored with author "alice" and the user "alice" has user id "11111111-1111-4111-8111-111111111111"
    And the legacy-author fix has detected "bbbbbbbb-0000-4000-8000-000000000001" but not yet rewritten it
    When user "33333333-3333-4333-8333-333333333333" registers a new formula "bbbbbbbb-0000-4000-8000-000000000002" before the rewrite applies
    And the owner "alice" updates "bbbbbbbb-0000-4000-8000-000000000001" so its author is already "11111111-1111-4111-8111-111111111111"
    Then "bbbbbbbb-0000-4000-8000-000000000002" keeps author "33333333-3333-4333-8333-333333333333" and its content is unchanged
    And "bbbbbbbb-0000-4000-8000-000000000001" keeps the owner's update and author "11111111-1111-4111-8111-111111111111"

  @AC-9 @FR-7
  Scenario: Apply refuses without a digest-matched, fully-confirmed plan and never touches system or UUID rows
    # Authority to run the fix is the DB credential holder plus the DBA change record (process, not code);
    # operator sign-off 2026-10-22. The digest is integrity, not authority. Order: edit plan -> hash -> record -> apply.
    Given the formula "bbbbbbbb-0000-4000-8000-000000000003" is stored with the reserved system author and "bbbbbbbb-0000-4000-8000-000000000004" is stored with author "alice"
    When apply is run with a missing or mismatched digest, or a plan that still holds a "suggested" entry, or a confirmed entry whose old author is the system author or a user id, or a new author that is not an active user id
    Then the run is refused with zero UPDATEs and no formula author has changed
    And when apply is run with a digest-matched, fully-confirmed plan, "bbbbbbbb-0000-4000-8000-000000000003" keeps the system author and its updated timestamp
