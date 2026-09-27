Feature: remove-agent-postgres-mcp (eliminate the DB-over-MCP surface)
  As a platform operator, I want the agent's db_* tools and its postgres-mcp co-process removed entirely
  with no MCP-fronted SQL replacement, so that a prompt-injected or compromised agent session has no
  tool, co-process, credential, or network path to execute any SQL.

  @AC-1 @FR-1
  Scenario: The xstockstrat-agent MCP advertises no db_ tool
    Given the running xstockstrat-agent MCP server (Streamable HTTP on :9000)
    When an authenticated admin lists the agent's tools (tools/list)
    Then the response contains none of db_execute_sql, db_list_schemas, db_list_objects, db_get_object_details, db_explain_query, db_get_top_queries, db_analyze_workload_indexes, db_analyze_query_indexes, db_analyze_db_health
    And the advertised tool count is 43 (the current 52-tool baseline minus the 9 db_ tools; re-derive against main-dev at execute-time)

  @AC-2 @FR-2
  Scenario: The agent container no longer runs or connects to postgres-mcp
    Given the xstockstrat-agent container is running
    When its process table, configuration, and dependencies are inspected
    Then there is no postgres-mcp co-process and no POSTGRES_MCP_DATABASE_URI / POSTGRES_MCP_PORT wiring
    And no agent code path opens a connection to a postgres-mcp SSE endpoint
    And postgres-mcp is absent from services/xstockstrat-agent/pyproject.toml and uv.lock, and "uv lock --check" passes

  @AC-3 @FR-3
  Scenario: The agent holds no direct DB connection and the pool-budget row is gone
    Given the connection-pool budget table in the root CLAUDE.md
    When the agent is deployed after removal
    Then there is no "xstockstrat-agent (postgres-mcp)" row in the budget table
    And the agent process holds no direct :25060 connection to the database
    And the direct-backend connection total is re-derived to reflect the removed connection

  @AC-4 @FR-5
  Scenario: Every tool-count / inventory surface agrees on the post-removal count
    Given the db_ tools have been removed from xstockstrat-agent
    When the CI-enforced inventory surfaces are checked
    Then services/xstockstrat-ui/src/lib/copilot.ts COPILOT_MCP_TOOL_COUNT equals 43 (current baseline 52 minus 9)
    And tests/test_tools_endpoint.py expected-name set omits all nine db_ tool names
    And the app/tools.py docstring, services/xstockstrat-agent/CLAUDE.md, and docs/runbooks/mcp-tools.md state the same post-removal count with no db_ tools listed

  @AC-5 @FR-4
  Scenario: No SQL-over-MCP surface exists and the sanctioned path is out-of-band
    Given the platform after this feature ships
    When an operator needs to run admin/DB SQL
    Then no MCP server (agent or otherwise) exposes any SQL-executing tool
    And docs/runbooks/operator-db-access.md documents the sanctioned out-of-band procedure (direct psql / DB client via SSH / doctl / bastion)

  @AC-6 @FR-6
  Scenario: A prompt-injected agent session cannot reach SQL by any path
    Given an xstockstrat-agent session whose LLM has ingested a prompt-injection payload instructing it to run arbitrary SQL
    When the injected instructions attempt to execute SQL
    Then no db_ tool exists in the agent to call
    And there is no postgres-mcp co-process, no DB credential in the agent environment, and no reachable SQL endpoint
    And no SQL reaches the database through the agent under any input

  @AC-7 @FR-1
  Scenario: Feature 169's agent-postgres-mcp business rules are removed, not left asserting a deleted surface
    Given feature 169's promoted suite services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature (13 scenarios)
    When the removal lands (C-16 CHANGE, operator sign-off recorded in context.md)
    Then no business-rule scenario in any durable suite still asserts that an agent db_ tool or postgres-mcp co-process exists
    And the removed/inverted scenarios reference this feature as provenance
