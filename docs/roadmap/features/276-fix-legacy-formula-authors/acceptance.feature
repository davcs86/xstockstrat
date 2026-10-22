Feature: fix-legacy-formula-authors (bug fix)
  Regression guard for the defect report docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md:
  formulas stored under a legacy username author are unreadable by their owner.

  @AC-1 @regression
  Scenario: A formula created before ownership moved to user id is owned by its user id
    Given the formula "31bb8ea6-0f3e-4cf7-8844-ec8294cebf85" is stored with author "davcs86"
    And the user "davcs86" has user id "80880990-2b79-4d85-8761-d8d9102c2efb"
    When the legacy-author fix has run
    Then the formula's author is "80880990-2b79-4d85-8761-d8d9102c2efb"
    And the owner's list_formulas returns it
    And the owner can execute it without PERMISSION_DENIED

  @AC-2 @regression
  Scenario: No formula keeps a username as its author after the fix
    Given formulas whose author is not a user id exist
    When the legacy-author fix has run
    Then no formula row has an author that is not a known user id
