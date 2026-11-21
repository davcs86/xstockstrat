# Promoted from feature 360 (fix-mcp-tools-page) at integration, C-16. Do not hand-edit; scenarios are verbatim.
Feature: fix-mcp-tools-page (bug fix) — UI BFF tool catalog
  The MCP tool catalog is served only on the agent's internal gRPC endpoint and read by the UI BFF.

  @AC-1 @regression @feature-360
  Scenario: The tool catalog is fetched from the agent's internal endpoint
    Given the UI runs with AGENT_ENDPOINT "xstockstrat-agent:50061"
    And AGENT_PUBLIC_URL is a public URL whose "/api/tools" answers 404
    And the agent's internal catalog RPC returns 2 tools
    When a logged-in user requests GET "/accounts/api/mcp-tools"
    Then the response is { "tools": [<2 tools>], "reachable": true }
    And no request is made to the AGENT_PUBLIC_URL host

  @AC-2 @regression @feature-360
  Scenario: An unavailable internal endpoint never falls back to the public URL
    Given the agent's internal catalog RPC is unavailable
    And AGENT_PUBLIC_URL is set
    When a logged-in user requests GET "/accounts/api/mcp-tools"
    Then the response is { "tools": [], "reachable": false }
    And no request is made to the AGENT_PUBLIC_URL host

  @AC-3 @feature-360
  Scenario: The catalog stays behind the UI session
    Given the UI runs with AGENT_ENDPOINT "xstockstrat-agent:50061"
    When a request without a session requests GET "/accounts/api/mcp-tools"
    Then the response status is 401
    And no request is made to the agent
