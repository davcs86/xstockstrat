Feature: fix-mcp-tools-page (bug fix)
  Regression guard for report docs/reports/2026-11-19-mcp-tools-page-empty-on-homelab-defect.md:
  MCP Tools page shows no tools on homelab deployments.

  @AC-1 @regression
  Scenario: The tool catalog is fetched from the agent's internal address
    Given the UI runs with AGENT_ENDPOINT "xstockstrat-agent:9000"
    And AGENT_PUBLIC_URL is a public URL whose "/api/tools" answers 404
    And the agent serves 2 tools at "http://xstockstrat-agent:9000/api/tools"
    When a logged-in user requests GET "/accounts/api/mcp-tools"
    Then the response is { "tools": [<2 tools>], "reachable": true }
    And no request is made to the AGENT_PUBLIC_URL host

  @AC-2 @regression
  Scenario: An unset internal address never falls back to the public URL
    Given the UI runs without AGENT_ENDPOINT
    And AGENT_PUBLIC_URL is set
    When a logged-in user requests GET "/accounts/api/mcp-tools"
    Then the response is { "tools": [], "reachable": false }
    And no request is made to the AGENT_PUBLIC_URL host

  @AC-3
  Scenario: The catalog stays behind the UI session
    Given the UI runs with AGENT_ENDPOINT "xstockstrat-agent:9000"
    When a request without a session requests GET "/accounts/api/mcp-tools"
    Then the response status is 401
    And no request is made to the agent
