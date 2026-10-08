# Promoted from feature 214 (remove-agent-postgres-mcp). Supersedes feature 169's
# agent-postgres-mcp.feature (deleted): the db_* tools and the postgres-mcp co-process were
# removed entirely (security H-5 / DT-2), so these guarantees assert the ABSENCE of that surface.
Feature: agent has no DB-over-MCP surface (postgres-mcp removed)
  As a platform operator, I want the agent's db_* tools and its postgres-mcp co-process removed
  entirely with no MCP-fronted SQL replacement, so that a prompt-injected or compromised agent
  session has no tool, co-process, credential, or network path to execute any SQL.

  @AC-1 @FR-1 @feature-214
  Scenario: The xstockstrat-agent MCP advertises no db_ tool
    Given the running xstockstrat-agent MCP server (Streamable HTTP on :9000)
    When an authenticated admin lists the agent's tools (tools/list)
    Then the response contains none of db_execute_sql, db_list_schemas, db_list_objects, db_get_object_details, db_explain_query, db_get_top_queries, db_analyze_workload_indexes, db_analyze_query_indexes, db_analyze_db_health
    And the advertised tool count is 45

  @AC-2 @FR-2 @feature-214
  Scenario: The agent container no longer runs or connects to postgres-mcp
    Given the xstockstrat-agent container is running
    When its process table, configuration, and dependencies are inspected
    Then there is no postgres-mcp co-process and no POSTGRES_MCP_DATABASE_URI / POSTGRES_MCP_PORT wiring
    And no agent code path opens a connection to a postgres-mcp SSE endpoint
    And postgres-mcp is absent from services/xstockstrat-agent/pyproject.toml and uv.lock

  @AC-6 @FR-6 @feature-214
  Scenario: A prompt-injected agent session cannot reach SQL by any path
    Given an xstockstrat-agent session whose LLM has ingested a prompt-injection payload instructing it to run arbitrary SQL
    When the injected instructions attempt to execute SQL
    Then no db_ tool exists in the agent to call
    And there is no postgres-mcp co-process, no DB credential in the agent environment, and no reachable SQL endpoint
    And no SQL reaches the database through the agent under any input
