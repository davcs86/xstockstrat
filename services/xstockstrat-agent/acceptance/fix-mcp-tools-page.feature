# Promoted from feature 360 (fix-mcp-tools-page) at integration, C-16. Do not hand-edit; scenarios are verbatim.
Feature: fix-mcp-tools-page (bug fix) — agent internal tool catalog
  The MCP tool catalog is served only on the agent's internal gRPC endpoint and read by the UI BFF.

  @AC-4 @feature-360
  Scenario: The agent's public port no longer serves the catalog
    Given the agent's HTTP app on port 9000
    When GET "/api/tools" is requested without a bearer token
    Then the response is not the tool catalog
    And the response status is 401

  @AC-5 @feature-360
  Scenario: Only the UI may read the internal catalog
    Given the agent's internal catalog RPC on port 50061 with mutual TLS
    When a platform service other than xstockstrat-ui calls it with its own certificate
    Then the call is rejected with PERMISSION_DENIED
    And a caller without a client certificate cannot complete the TLS handshake

  @AC-6 @feature-360
  Scenario: The internal catalog lists every registered tool
    Given the agent's internal catalog RPC
    When xstockstrat-ui lists the tools
    Then every registered MCP tool is returned with its name, description and input schema
