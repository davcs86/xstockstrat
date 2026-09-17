Feature: sysadmin-db-write-role
  As a platform operator, I want a dedicated sysadmin role that is the only privilege permitted to
  execute write/destructive SQL through the agent's db_execute_sql tool and is grantable only via
  scripts/manage-users.py, so that a prompt-injected or compromised admin session cannot perform
  arbitrary DB writes.

  @AC-1 @FR-1 @FR-4
  Scenario: An admin without sysadmin is denied a write via db_execute_sql
    Given a caller whose verified JWT roles are ["admin"] (derived access-scope has ADMIN 0x04 set, SYSADMIN 0x10 unset)
    When they call db_execute_sql with sql "UPDATE trading.orders SET status='CANCELED' WHERE order_id='x'" and confirm=true
    Then the tool returns a PERMISSION_DENIED error naming the missing sysadmin privilege
    And no statement is forwarded to postgres-mcp

  @AC-2 @FR-1 @FR-2
  Scenario: A sysadmin may execute a write via db_execute_sql
    Given a caller whose verified JWT roles are ["sysadmin"] (derived access-scope has SYSADMIN 0x10 set)
    When they call db_execute_sql with sql "UPDATE analysis.strategies SET is_live=false WHERE strategy_id='s1'"
    Then the statement is forwarded to postgres-mcp and executed
    And the tool returns the execution result

  @AC-3 @FR-2
  Scenario: An admin without sysadmin may still run read-only SQL
    Given a caller whose verified JWT roles are ["admin"] (ADMIN 0x04 set, SYSADMIN 0x10 unset)
    When they call db_execute_sql with sql "SELECT count(*) FROM trading.orders"
    Then the statement is forwarded to postgres-mcp and executed
    And the tool returns the row count

  @AC-4 @FR-2 @FR-4
  Scenario: INSERT is treated as a write and requires sysadmin
    Given a caller whose verified JWT roles are ["admin"] (SYSADMIN 0x10 unset)
    When they call db_execute_sql with sql "INSERT INTO config.config_audit (namespace) VALUES ('x')"
    Then the tool returns a PERMISSION_DENIED error naming the missing sysadmin privilege
    And no statement is forwarded to postgres-mcp

  @AC-5 @FR-3
  Scenario: The agent manage_user tool cannot grant sysadmin
    Given an authenticated admin caller using the agent manage_user tool with action "set_roles"
    When they attempt to set a target user's roles to include "sysadmin"
    Then the request cannot express the sysadmin role (the proto Role enum has no sysadmin value)
    And the target user's stored roles do not contain "sysadmin"

  @AC-6 @FR-3
  Scenario: The identity SetUserRoles RPC cannot assign sysadmin
    Given a SetUserRolesRequest whose repeated Role field is populated from the closed proto enum {ADMIN, TRADER, VIEWER}
    When the request is sent for any target user
    Then no combination of enum values yields the "sysadmin" role string on the persisted user

  @AC-7 @FR-3
  Scenario: manage-users.py can grant sysadmin (the sole assignment path)
    Given an operator running "uv run scripts/manage-users.py update-roles ops@localhost --roles sysadmin,admin"
    When the command completes
    Then identity.users.roles for ops@localhost contains "sysadmin"
    And a subsequent login for ops@localhost issues a JWT whose roles claim includes "sysadmin"

  @AC-8 @FR-4
  Scenario: An unauthenticated / roleless caller is denied a write fail-closed
    Given a caller with no verified roles (derived access-scope 0)
    When they call db_execute_sql with any write statement
    Then the tool returns a PERMISSION_DENIED error
    And no statement is forwarded to postgres-mcp

  @AC-9 @FR-1 @FR-4
  Scenario: The sysadmin role maps to the SYSADMIN scope bit consistently across mirrors
    Given the roles list ["sysadmin"]
    When the access scope is derived by the agent (app/scopes.py roles_to_access_scope) and by the UI (src/lib/auth.ts rolesToAccessScope)
    Then both derivations set the SYSADMIN bit (0x10)
    And both leave the SYSADMIN bit unset for the roles list ["admin"]
