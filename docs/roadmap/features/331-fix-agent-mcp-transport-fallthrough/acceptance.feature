Feature: fix-agent-mcp-transport-fallthrough (bug fix)
  Regression guard for defect report: agent silently starts stdio transport when MCP_TRANSPORT is
  unset or mistyped.

  # guards: docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md
  @AC-1 @regression
  Scenario: an unrecognized MCP_TRANSPORT fails the agent at startup
    Given the agent container starts with MCP_TRANSPORT="htp"
    When the agent resolves its transport
    Then the process exits non-zero with an error naming the value "htp"
    And it does not start the stdio transport

  # guards: docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md
  @AC-2 @regression
  Scenario: an unset MCP_TRANSPORT starts the Streamable HTTP transport
    Given the agent container starts with MCP_TRANSPORT unset
    When the agent resolves its transport
    Then it runs the Streamable HTTP transport on port 9000
    And it does not start the stdio transport

  # guards: docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md
  @AC-3 @regression
  Scenario Outline: an explicit recognized MCP_TRANSPORT still selects its transport
    Given the agent starts with MCP_TRANSPORT="<value>"
    When the agent resolves its transport
    Then it runs the <transport> transport

    Examples:
      | value | transport            |
      | http  | Streamable HTTP :9000 |
      | stdio | stdio                |
