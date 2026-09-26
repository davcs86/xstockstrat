Feature: sysadmin-db-write-role (privilege-separated psql MCP)
  As a platform operator, I want the database tooling separated out of the AI agent into a standalone
  "psql MCP" service that authenticates independently of the xstockstrat login and ACL, so that a
  prompt-injected or compromised xstockstrat-agent session has no tool, credential, or network path to
  execute any SQL, while a human operator reaches the DB tools through their own out-of-band credential.

  @AC-1 @FR-1
  Scenario: The xstockstrat-agent MCP no longer advertises any db_ tool
    Given the running xstockstrat-agent MCP server (Streamable HTTP on :9000)
    When an authenticated admin lists the agent's tools (tools/list)
    Then the response contains none of db_execute_sql, db_list_schemas, db_list_objects, db_get_object_details, db_explain_query, db_get_top_queries, db_analyze_workload_indexes, db_analyze_query_indexes, db_analyze_db_health
    And the advertised tool count is 43 (the current 52-tool baseline minus the 9 db_ tools; re-derive against main-dev at execute-time)

  @AC-2 @FR-1
  Scenario: Every tool-count/inventory surface agrees on the post-removal count
    Given the db_ tools have been removed from xstockstrat-agent
    When the CI-enforced inventory surfaces are checked
    Then src/lib/copilot.ts COPILOT_MCP_TOOL_COUNT equals 43 (current baseline 52 minus 9)
    And the tests/test_tools_endpoint.py expected-name set omits all nine db_ tool names
    And the app/tools.py docstring and services/xstockstrat-agent/CLAUDE.md and docs/runbooks/mcp-tools.md state the same post-removal count

  @AC-3 @FR-1
  Scenario: The xstockstrat-agent container no longer runs or connects to postgres-mcp
    Given the xstockstrat-agent container is running
    When its process table and configuration are inspected
    Then there is no postgres-mcp co-process and no POSTGRES_MCP_DATABASE_URI / POSTGRES_MCP_PORT wiring in the agent
    And no agent code path opens a connection to a postgres-mcp SSE endpoint

  @AC-4 @FR-2
  Scenario: The psql MCP is an isolated, internal-only container with no public route
    Given the psql MCP deployed as an isolated supervisord container on the droplet (feature 084)
    When an operator with droplet/host access starts it and connects out-of-band (SSH / port-forward tunnel)
    Then it reaches the isolated psql MCP process, not xstockstrat-agent, and is a separate process group with its own environment
    And there is NO public ingress route to it (it is not a DO App Platform service/component and not exposed under /agent or any public prefix)
    And the xstockstrat-agent MCP continues to serve only its own tools with no db_ tools

  @AC-5 @FR-3 @FR-2
  Scenario: A caller with the psql MCP's own credential can invoke the DB tools
    Given an operator presenting the psql MCP's out-of-band credential (e.g. its configured bearer token)
    When they call a DB tool through the psql MCP (e.g. execute_sql "SELECT count(*) FROM trading.orders")
    Then the psql MCP authenticates the caller against its own credential (not the xstockstrat identity service)
    And the statement is executed via the fronted postgres-mcp and the result is returned

  @AC-6 @FR-3 @FR-4
  Scenario: A valid xstockstrat admin JWT confers no access to the psql MCP
    Given a caller holding a valid xstockstrat OAuth/JWT whose roles include "admin"
    When they present that JWT (and no psql-MCP credential) to the psql MCP endpoint
    Then the psql MCP rejects the request fail-closed (no DB tool is executed)
    And the rejection does not consult the xstockstrat identity service or access-scope ACL

  @AC-7 @FR-3
  Scenario: A caller with no psql credential is denied fail-closed
    Given a caller presenting no psql-MCP credential
    When they attempt to list or invoke any psql MCP tool
    Then the psql MCP returns an authentication error
    And no tool is executed and no DB tool names are leaked to an unauthenticated caller

  @AC-8 @FR-4
  Scenario: A prompt-injected xstockstrat-agent session cannot reach SQL
    Given an xstockstrat-agent session whose LLM has ingested a prompt-injection payload instructing it to run arbitrary SQL
    When the injected instructions attempt to execute SQL
    Then no db_ tool exists in the agent to call
    And the agent holds no psql-MCP token, so even while the psql MCP is running any request it makes over the droplet docker network is rejected fail-closed (401)
    And while the psql MCP is stopped there is no reachable DB-tool surface at all
    And no SQL reaches the database through the agent
    # NOTE: internal-only, no public route (FR-2). The per-operator token the agent does not hold is the
    # boundary while the container is up; the ephemeral on/off (FR-9) removes the surface when down.

  @AC-9 @FR-5
  Scenario: The psql MCP connects with the DML-only role so DDL stays denied at the grant level
    Given the psql MCP's fronted postgres-mcp connects as the dedicated DML-only DB role (SELECT/INSERT/UPDATE/DELETE, no DDL)
    When an authenticated psql-MCP caller runs "INSERT INTO config.config_audit (namespace) VALUES ('x')" and separately "CREATE TABLE public.evil (id int)"
    Then the INSERT succeeds
    And the CREATE TABLE is rejected by Postgres at the grant level, independent of the tool layer

  @AC-10 @FR-6
  Scenario: The shared DB connection-pool budget is preserved
    Given the connection-pool budget table in the root CLAUDE.md
    When the psql MCP owns the postgres-mcp direct connection instead of xstockstrat-agent
    Then the postgres-mcp process still holds exactly one direct connection
    And the direct-backend connection total is unchanged (the budget row is re-labeled to the psql MCP, not added)

  @AC-11 @FR-7
  Scenario: A DB statement is attributed to the resolved operator in a durable audit record
    Given operator "alice" holds a provisioned per-operator token in PSQL_MCP_TOKENS and operator "bob" holds a different one
    When alice calls execute_sql "UPDATE analysis.strategies SET is_live=false WHERE strategy_id='s1'" through the psql MCP
    Then the psql MCP resolves the presented token to operator-id "alice" (not "bob") in constant time
    And a durable audit record is written containing the statement, operator-id "alice", the source IP, and a timestamp
    And that audit record is stored where the DML role cannot modify or delete it

  @AC-12 @FR-7
  Scenario: Revoking one operator's token does not affect another's, and audit is non-optional
    Given operators "alice" and "bob" each hold a distinct active token
    When alice's entry is marked active=false and the service reloads its token set
    Then alice's token is rejected fail-closed while bob's token still authenticates
    And the psql MCP refuses to start (or refuses requests) if its durable audit sink is unavailable, rather than serving with auditing silently disabled

  @AC-13 @FR-8
  Scenario: Repeated failed authentication is rate-limited and locked out
    Given the running psql MCP (internal-only) receiving authentication attempts
    When a caller presents invalid bearer tokens repeatedly beyond the configured failed-auth threshold
    Then the psql MCP returns HTTP 429 for further attempts from that source for the configured lockout window
    And no tool name or catalog is ever returned to an unauthenticated caller
    # The exact threshold + lockout-window values are pinned at /sdd-spec (or a config/env knob); this
    # scenario asserts the enforce-then-429 behavior, not specific numbers.

  @AC-14 @FR-8
  Scenario: The bearer token is never written to any log
    Given a request to the psql MCP carrying "Authorization: Bearer <token>"
    When the request is processed (whether it authenticates or is rejected)
    Then no access log, application log, audit record, or SDK log line contains the bearer token value
    And any audit record instead names the resolved operator-id

  @AC-15 @FR-9 @FR-2
  Scenario: The DB-tool surface is present only while the operator runs the container
    Given the psql MCP container is stopped on the droplet (its default resting state)
    When any caller attempts to reach the psql MCP endpoint
    Then there is no listening psql MCP process and no postgres-mcp co-process, so nothing is reachable and no DB connection is held
    When the operator runs "docker start" on the psql MCP container for an admin session
    Then the psql MCP and its localhost postgres-mcp co-process come up and a credentialed operator can use the DB tools
    And after "docker stop" the surface and its DB connection are gone again
