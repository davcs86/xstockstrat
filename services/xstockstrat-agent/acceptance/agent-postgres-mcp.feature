Feature: agent-postgres-mcp — database analysis tools via postgres-mcp co-process
  Admin-only db_* tools exposed through the xstockstrat-agent MCP endpoint, backed by
  a supervisord-managed postgres-mcp co-process connecting as the xstockstrat_agent role.

  @AC-1 @FR-1 @FR-10 @feature-169
  Scenario: Both processes start and stay alive under supervisord
    Given the xstockstrat-agent container starts with supervisord as PID 1
    When both "app.main" and "postgres-mcp" child processes have been launched
    Then supervisord reports both processes as RUNNING within 30 seconds
    And the agent MCP endpoint responds to a GET / with status 200

  @AC-2 @FR-1 @feature-169
  Scenario: Supervisord restarts a crashed co-process
    Given both processes are RUNNING under supervisord
    When the postgres-mcp process is killed with SIGKILL
    Then supervisord restarts it within 5 seconds
    And the agent MCP endpoint continues to respond to GET / with status 200

  @AC-4 @FR-3 @feature-169
  Scenario: postgres-mcp connects using the DML-capable role and DDL is rejected
    Given POSTGRES_MCP_DATABASE_URI points to the xstockstrat_agent Postgres role
    When postgres-mcp initializes its database connection
    Then a query "SELECT current_user" returns "xstockstrat_agent"
    And an INSERT statement on an existing table succeeds
    And an attempt to execute "CREATE TABLE _test_forbidden (id int)" raises "permission denied"

  @AC-5 @FR-4 @FR-6 @feature-169
  Scenario: Admin caller invokes a db_ tool through the agent MCP endpoint
    Given a valid admin OAuth JWT (x-access-scope bit 0x04 set) is presented
    When the caller sends a tools/call request for "db_analyze_db_health" with arguments {"health_type": "all"}
    Then the agent returns a non-empty text tool result
    And the response does not expose the POSTGRES_MCP_DATABASE_URI connection string

  @AC-6 @FR-5 @feature-169
  Scenario: Non-admin caller is rejected for any db_ tool
    Given a valid OAuth JWT with non-admin scope (x-access-scope bit 0x04 NOT set) is presented
    When the caller sends a tools/call request for "db_explain_query" with arguments {"sql": "SELECT 1"}
    Then the agent returns an error response with code "PERMISSION_DENIED"
    And the db_explain_query call is NOT forwarded to the local postgres-mcp process

  @AC-9 @FR-7 @feature-169
  Scenario: All six tool-inventory surfaces are kept in sync
    Given the agent exposes exactly 9 db_ tools
    When all six tool-inventory surfaces are read
    Then every surface reflects the same total agent tool count (42)
    And COPILOT_MCP_TOOL_COUNT in copilot.ts equals 42

  @AC-11 @FR-9 @feature-169
  Scenario: POSTGRES_MCP_DATABASE_URI is injected in all deployment environments
    Given the docker-compose.yml, .do/app.dev.yaml, and .do/app.yaml files are read
    When each file's xstockstrat-agent environment block is inspected
    Then POSTGRES_MCP_DATABASE_URI is present in all three files

  @AC-12 @FR-11 @feature-169
  Scenario: Destructive DML (UPDATE) is blocked without confirmation
    Given a valid admin OAuth JWT (x-access-scope bit 0x04 set) is presented
    When the caller sends a tools/call request for "db_execute_sql" with SQL containing "UPDATE" and no confirm=true
    Then the agent returns a dry-run response without forwarding to postgres-mcp
    And no rows are modified in the database

  @AC-13 @FR-11 @feature-169
  Scenario: Destructive DML executes after explicit confirmation
    Given a valid admin OAuth JWT (x-access-scope bit 0x04 set) is presented
    When the caller sends a tools/call request for "db_execute_sql" with SQL containing "UPDATE" and confirm=true
    Then the agent forwards the call to postgres-mcp
