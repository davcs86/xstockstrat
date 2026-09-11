# Durable per-service business rules for xstockstrat-ui, promoted from feature 179's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-179` tag. These are the guarantees a future feature must not silently break.

Feature: ui-resume-halted-account (ui)
  The /trader account-management surface shows when a broker account is halted and offers an
  admin-only Resume control (against the pre-existing admin-only ResumeAccount RPC) to clear the halt.

  @AC-1 @FR-2 @feature-179
  Scenario: Halt indicator shown on the account-management surface without placing an order
    Given a broker account halted with reason "reconciliation mismatch" and source RECONCILIATION
    When the admin opens the account-management surface
    Then the account row shows a halted indicator with reason "reconciliation mismatch" and a RECONCILIATION badge
    And the halt is visible before any order is attempted

  @AC-2 @FR-3 @feature-179
  Scenario: Resume control appears only for a halted account
    Given one halted account and one healthy account
    When the admin views both on the account-management surface
    Then only the halted account shows a Resume control
    And the healthy account shows no Resume control

  @AC-3 @FR-1 @FR-4 @feature-179
  Scenario: Resume clears the halt from the UI
    Given a halted account visible to an admin, who confirms the Resume dialog
    When the resumeAccount BFF route calls ResumeAccount successfully
    Then the account's halt indicator clears
    And the Resume control disappears
    And the outbound call carried the admin's x-user-id, x-access-scope, and x-trace-id

  @AC-4 @FR-4 @feature-179
  Scenario: Resuming an already-resumed account is a benign no-op
    Given an account that is not halted
    When a resumeAccount call is issued for it
    Then the call succeeds without error and the account remains active

  @AC-5 @FR-5 @feature-179
  Scenario: A non-admin caller cannot resume
    Given a caller whose access scope is "operator" (not admin)
    When they view a halted account
    Then no actionable Resume control is offered
    And a direct resumeAccount call for that account is rejected by the BFF/RPC admin-scope check with a permission error

  @AC-6 @FR-3 @feature-179
  Scenario: Resume requires confirmation surfacing the halt reason
    Given a halted account with reason "bracket flatten failed" visible to an admin
    When the admin clicks Resume
    Then a confirmation dialog appears showing the reason "bracket flatten failed"
    And no resumeAccount call is made until the admin confirms
    And dismissing the dialog leaves the account halted
