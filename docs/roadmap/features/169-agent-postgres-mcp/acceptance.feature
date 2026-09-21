Feature: agent-postgres-mcp
  As an admin operator, I want to invoke Postgres analysis tools through the existing
  xstockstrat MCP endpoint, so that I can diagnose query performance and schema issues
  without needing direct DB credentials or a separate tool connection.

  @AC-1 @FR-1 @FR-10
  Scenario: Both processes start and stay alive under supervisord
    Given the xstockstrat-agent container starts with supervisord as PID 1
    When both "app.main" and "postgres-mcp" child processes have been launched
    Then supervisord reports both processes as RUNNING within 30 seconds
    And the agent MCP endpoint responds to a GET / with status 200

  @AC-2 @FR-1
  Scenario: Supervisord restarts a crashed co-process
    Given both processes are RUNNING under supervisord
    When the postgres-mcp process is killed with SIGKILL
    Then supervisord restarts it within 5 seconds
    And the agent MCP endpoint continues to respond to GET / with status 200

  @AC-3 @FR-2
  Scenario: postgres-mcp is not reachable from outside the container
    Given the agent container is running with postgres-mcp bound to localhost
    When a network probe attempts TCP connection to the postgres-mcp port from outside the container
    Then the connection is refused

  @AC-4 @FR-3
  Scenario: postgres-mcp connects using the DML-capable role and DDL is rejected
    Given POSTGRES_MCP_DATABASE_URI points to the xstockstrat_agent Postgres role
    When postgres-mcp initializes its database connection
    Then a query "SELECT current_user" returns "xstockstrat_agent"
    And an INSERT statement on an existing table succeeds
    And an attempt to execute "CREATE TABLE _test_forbidden (id int)" raises "permission denied"

  @AC-5 @FR-4 @FR-6
  Scenario: Admin caller invokes a db_ tool through the agent MCP endpoint
    Given a valid admin OAuth JWT (x-access-scope bit 0x04 set) is presented
    When the caller sends a tools/call request for "db_analyze_db_health" with arguments {"health_type": "all"}
    Then the agent returns a non-empty text tool result containing at least one of the labeled section keywords ("index", "connection", "vacuum", "sequence", "replication", "buffer", or "constraint") confirming postgres-mcp produced output
    And the response does not expose the POSTGRES_MCP_DATABASE_URI connection string

  @AC-6 @FR-5
  Scenario: Non-admin caller is rejected for any db_ tool
    Given a valid OAuth JWT with non-admin scope (x-access-scope bit 0x04 NOT set) is presented
    When the caller sends a tools/call request for "db_explain_query" with arguments {"sql": "SELECT 1"}
    Then the agent returns an error response with code "PERMISSION_DENIED"
    And the db_explain_query call is NOT forwarded to the local postgres-mcp process

  @AC-7 @FR-5
  Scenario: Unauthenticated caller cannot discover or invoke db_ tools
    Given no Authorization header is present
    When the caller sends a GET request to the agent MCP endpoint
    Then the response status is 401
    And the response body does not list any "db_" tool names

  @AC-8 @FR-6
  Scenario: All postgres-mcp tools are re-exposed with the db_ prefix
    Given the agent is running with postgres-mcp co-process active
    When an admin caller sends a tools/list request to the agent MCP endpoint
    Then every tool originating from postgres-mcp appears with a "db_" name prefix
    And no postgres-mcp tool name appears without the "db_" prefix

  @AC-9 @FR-7
  Scenario: All six tool-inventory surfaces are kept in sync
    Given the agent exposes exactly 9 db_ tools:
      | db_list_schemas | db_list_objects | db_get_object_details |
      | db_execute_sql  | db_explain_query | db_get_top_queries   |
      | db_analyze_workload_indexes | db_analyze_query_indexes | db_analyze_db_health |
    When all six tool-inventory surfaces are read:
      | app/tools.py module docstring |
      | services/xstockstrat-agent/CLAUDE.md tool table |
      | docs/runbooks/mcp-tools.md header count |
      | docs/runbooks/mcp-tools.md per-tool entries |
      | tests/test_tools_endpoint.py exact-name set |
      | services/xstockstrat-ui/src/lib/copilot.ts COPILOT_MCP_TOOL_COUNT |
    Then every surface reflects the same total agent tool count (prior count + 9)
    And each of the 9 db_ tools has a section in mcp-tools.md with parameters, return shape, and "Admin-only" annotation
    And COPILOT_MCP_TOOL_COUNT in copilot.ts equals the new total tool count
    And documentation surfaces (app/tools.py docstring, CLAUDE.md tool table, mcp-tools.md header count, mcp-tools.md per-tool entries) are verified by PR diff review; runtime surfaces (tests/test_tools_endpoint.py exact-name set and copilot.ts COPILOT_MCP_TOOL_COUNT constant) are enforced by the CI test suite

  @AC-10 @FR-8
  Scenario: postgres-mcp respects the connection pool budget
    Given the connection budget table shows 1 new direct slot for postgres-mcp (xstockstrat_agent)
    When the agent container is running and postgres-mcp is initialized
    Then exactly 1 backend connection from the xstockstrat_agent role appears in pg_stat_activity
    And the direct-backend total in root CLAUDE.md is updated to reflect this new slot (verified by PR diff review)

  @AC-11 @FR-9
  Scenario: POSTGRES_MCP_DATABASE_URI is injected in all deployment environments
    Given the docker-compose.yml, .do/app.dev.yaml, and .do/app.yaml files are read
    When each file's xstockstrat-agent environment block is inspected
    Then POSTGRES_MCP_DATABASE_URI is present in all three files
    And the docker-compose value points to the local timescaledb service
    And the DO app spec values reference the managed-DB connection string for the xstockstrat_agent role

  @AC-12 @FR-11
  Scenario: Destructive DML (UPDATE) is blocked without confirmation
    Given a valid admin OAuth JWT (x-access-scope bit 0x04 set) is presented
    When the caller sends a tools/call request for "db_execute_sql" with arguments {"sql": "UPDATE config.config_keys SET value_data = 'x' WHERE id = 1"}
    And the request does not include "confirm": true
    Then the agent returns a response containing the message "Destructive operation requires confirmation. Re-invoke with confirm=true to execute."
    And no rows are modified in the database
    And the db_execute_sql call is NOT forwarded to the local postgres-mcp process

  @AC-13 @FR-11
  Scenario: Destructive DML executes after explicit confirmation
    Given a valid admin OAuth JWT (x-access-scope bit 0x04 set) is presented
    When the caller sends a tools/call request for "db_execute_sql" with arguments {"sql": "UPDATE config.config_keys SET value_data = 'x' WHERE id = 1", "confirm": true}
    Then the agent forwards the call to postgres-mcp
    And the result includes the number of rows affected (e.g. "1 row updated")
