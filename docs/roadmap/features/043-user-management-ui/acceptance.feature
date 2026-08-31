Feature: user-management-ui
  As a platform administrator, I want to manage user accounts from the config-ui
  Users section, so that I can create users, reset passwords, assign roles, and
  deactivate accounts without direct database access — with every action gated to
  admins and recorded to the ledger.

  @AC-1 @FR-1
  Scenario: Admin lists all users
    Given the caller holds the "admin" role
    When the caller invokes "ListUsers"
    Then the response contains every user's email, roles, active status, and created date
    And no user entry contains a password or password hash field

  @AC-2 @FR-2
  Scenario: Admin creates a new user who can then sign in
    Given the caller holds the "admin" role
    When the caller invokes "CreateUser" with email "alice@example.com", an initial password, and roles ["trader"]
    Then the created user appears in a subsequent "ListUsers" response with is_active = true
    And "alice@example.com" can log in with the supplied initial password

  @AC-3 @FR-3
  Scenario: Admin resets a user's password without the current password
    Given the caller holds the "admin" role and a user "alice@example.com" exists
    When the caller invokes "UpdatePassword" for that user with a new password and no current-password argument
    Then the RPC succeeds and the response body contains no password or password hash field
    And the user can log in with the new password
    And the user's previous password no longer authenticates

  @AC-4 @FR-4
  Scenario: Admin assigns and removes roles
    Given the caller holds the "admin" role and a user "alice@example.com" has roles ["trader"]
    When the caller invokes "SetUserRoles" for that user with roles ["trader", "admin"]
    Then a subsequent "GetUser" for that user returns roles ["trader", "admin"]
    And invoking "SetUserRoles" again with roles ["trader"] removes "admin" from that user

  @AC-5 @FR-5
  Scenario: Admin deactivates a user, blocking login
    Given the caller holds the "admin" role and a user "alice@example.com" is active
    When the caller invokes "SetUserActive" for that user with active = false
    Then a subsequent "GetUser" for that user returns is_active = false
    And a login attempt for "alice@example.com" is rejected with an authentication error

  @AC-6 @FR-6
  Scenario: Admin reactivates a previously deactivated user
    Given the caller holds the "admin" role and a user "alice@example.com" has is_active = false
    When the caller invokes "SetUserActive" for that user with active = true
    Then a subsequent "GetUser" for that user returns is_active = true
    And "alice@example.com" can log in again

  @AC-7 @FR-7
  Scenario: A non-admin caller is denied every user-management RPC
    Given the caller does not hold the "admin" role
    When the caller invokes any of "CreateUser", "ListUsers", "GetUser", "UpdatePassword", "SetUserRoles", or "SetUserActive"
    Then the RPC is rejected with a PERMISSION_DENIED error
    And no user record is created, modified, or read back to the caller

  @AC-8 @FR-8
  Scenario: Every user-management action writes a ledger audit event
    Given the caller holds the "admin" role
    When the caller successfully invokes "CreateUser", "UpdatePassword", "SetUserRoles", or "SetUserActive"
    Then a corresponding audit event is appended to the ledger identifying the acting admin and the affected user
    And the audit event contains no password or password hash value

  @AC-9 @FR-9
  Scenario: The Users section is reachable within config-ui
    Given an admin is signed in to the "/config-ui" segment of xstockstrat-ui
    When the admin opens the shared config-ui navigation
    Then a "Users" section is present and links to the user list page
    And the user list page renders each user's email, roles, active status, and created date

  @AC-10 @FR-10
  Scenario: Passwords are never returned or displayed
    Given the caller holds the "admin" role
    When the caller invokes "CreateUser", "UpdatePassword", "GetUser", or "ListUsers"
    Then no response payload, log line, or rendered UI field contains a plaintext password or a password hash

  @AC-11 @FR-11
  Scenario: The last active admin cannot be deactivated or demoted
    Given the caller holds the "admin" role
    And "admin@localhost" is the only remaining active user with the "admin" role
    When the caller invokes "SetUserActive" for "admin@localhost" with active = false
    Then the RPC is rejected with a FAILED_PRECONDITION error "cannot remove last admin"
    And "admin@localhost" is still active and still holds the "admin" role
    When the caller instead invokes "SetUserRoles" for "admin@localhost" with roles ["trader"]
    Then the RPC is rejected with a FAILED_PRECONDITION error "cannot remove last admin"
    And "admin@localhost" still holds the "admin" role
