# Durable per-service business rules for xstockstrat-agent, promoted from feature 183's
# acceptance.feature at archive time (Constitution C-16; the launch-time promotion was missed).
# New acceptance directory for xstockstrat-agent's MCP user/role/profile admin tools. Source-feature
# provenance is carried on every scenario's `@feature-183` tag. These are guarantees a future feature
# must not silently break.

Feature: mcp-user-profile-roles (agent)
  MCP agent admin tools for managing users, roles, and any user's profile metadata —
  each admin-gated (access-scope bit 0x04) and password-secret.

  @AC-1 @FR-1 @FR-9 @feature-183
  Scenario: Admin creates a new user via manage_user
    Given an authenticated caller whose roles include "admin" (access scope has bit 0x04 set)
    When they call manage_user with operation "create", email "quant@example.com", password "Str0ng-P4ss!", and roles ["trader"]
    Then a new identity user row is created with email "quant@example.com" and roles {"trader"}
    And the tool returns the new user's user_id, email "quant@example.com", roles ["trader"], and is_active true
    And the returned payload does not contain the plaintext password

  @AC-2 @FR-2 @FR-9 @feature-183
  Scenario: Admin replaces a user's roles via manage_user set_roles
    Given an authenticated admin caller and an existing user with roles {"trader"}
    When they call manage_user with operation "set_roles", the target user_id, and roles ["trader","admin"]
    Then the user's roles become {"admin","trader"}
    And the tool returns the updated user with roles ["admin","trader"]

  @AC-3 @FR-3 @FR-9 @feature-183
  Scenario: Admin deactivates a user via manage_user set_active
    Given an authenticated admin caller and an active user other than the last remaining active admin
    When they call manage_user with operation "set_active" and active false for that user_id
    Then the user's is_active becomes false
    And the tool returns the updated user with is_active false

  @AC-4 @FR-4 @FR-9 @feature-183
  Scenario: Admin resets a user's password via manage_user reset_password
    Given an authenticated admin caller and an existing user
    When they call manage_user with operation "reset_password", the target user_id, and password "N3w-P4ssw0rd!"
    Then identity stores a new password hash for that user
    And the tool returns a success result that does not echo the new password

  @AC-5 @FR-5 @FR-9 @feature-183
  Scenario: Admin lists all users via list_users
    Given an authenticated admin caller and three existing users
    When they call list_users
    Then the tool returns three entries, each with user_id, email, roles, is_active, and created_at

  @AC-6 @FR-6 @FR-9 @feature-183
  Scenario: Admin fetches one user via get_user
    Given an authenticated admin caller and a user with user_id "11111111-1111-1111-1111-111111111111"
    When they call get_user with that user_id
    Then the tool returns that user's user_id "11111111-1111-1111-1111-111111111111", email, roles, and is_active

  @AC-7 @FR-7 @FR-9 @FR-10 @feature-183
  Scenario: Admin reads another user's profile metadata
    Given an authenticated admin caller and a target user whose profile has display_name "Jane Q" and phone "+1-555-0100"
    When they read the target user's profile metadata by that target user_id
    Then the tool returns display_name "Jane Q", phone "+1-555-0100", and the metadata JSON for that target user
    And the read resolves the target from the request user_id, not from the caller's x-user-id

  @AC-8 @FR-8 @FR-9 @FR-10 @feature-183
  Scenario: Admin updates another user's profile metadata (partial)
    Given an authenticated admin caller and a target user whose profile has display_name "Jane Q" and phone "+1-555-0100"
    When they update the target user's profile with display_name "Jane Quant" only
    Then the target user's display_name becomes "Jane Quant"
    And the target user's phone remains "+1-555-0100"
    And metadata_updated_at advances

  @AC-9 @FR-9 @feature-183
  Scenario: Non-admin caller is denied every management tool
    Given an authenticated caller whose roles are ["trader"] (access scope lacks bit 0x04)
    When they call manage_user (any operation), list_users, get_user, or the admin profile read/write surface
    Then the call fails with PERMISSION_DENIED
    And no user row, role set, active flag, password, or profile field is modified
