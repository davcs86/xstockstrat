Feature: fix-mcp-tools-page (bug fix)
  Regression guard for report docs/reports/2026-11-19-mcp-tools-page-empty-on-homelab-defect.md:
  MCP Tools page shows no tools on homelab deployments.
  Run 2 (2026-11-19): the catalog is served on an internal gRPC port; @AC-1..3 reworded, @AC-4..6 added.

  @AC-1 @regression
  Scenario: The tool catalog is fetched from the agent's internal endpoint
    Given the UI runs with AGENT_ENDPOINT "xstockstrat-agent:50061"
    And AGENT_PUBLIC_URL is a public URL whose "/api/tools" answers 404
    And the agent's internal catalog RPC returns 2 tools
    When a logged-in user requests GET "/accounts/api/mcp-tools"
    Then the response is { "tools": [<2 tools>], "reachable": true }
    And no request is made to the AGENT_PUBLIC_URL host

  @AC-2 @regression
  Scenario: An unavailable internal endpoint never falls back to the public URL
    Given the agent's internal catalog RPC is unavailable
    And AGENT_PUBLIC_URL is set
    When a logged-in user requests GET "/accounts/api/mcp-tools"
    Then the response is { "tools": [], "reachable": false }
    And no request is made to the AGENT_PUBLIC_URL host

  @AC-3
  Scenario: The catalog stays behind the UI session
    Given the UI runs with AGENT_ENDPOINT "xstockstrat-agent:50061"
    When a request without a session requests GET "/accounts/api/mcp-tools"
    Then the response status is 401
    And no request is made to the agent

  @AC-4
  Scenario: The agent's public port no longer serves the catalog
    Given the agent's HTTP app on port 9000
    When GET "/api/tools" is requested without a bearer token
    Then the response is not the tool catalog
    And the response status is 401

  @AC-5
  Scenario: Only the UI may read the internal catalog
    Given the agent's internal catalog RPC on port 50061 with mutual TLS
    When a platform service other than xstockstrat-ui calls it with its own certificate
    Then the call is rejected with PERMISSION_DENIED
    And a caller without a client certificate cannot complete the TLS handshake

  @AC-6
  Scenario: The internal catalog lists every registered tool
    Given the agent's internal catalog RPC
    When xstockstrat-ui lists the tools
    Then every registered MCP tool is returned with its name, description and input schema
