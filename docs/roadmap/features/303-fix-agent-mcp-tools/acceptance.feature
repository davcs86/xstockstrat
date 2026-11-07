Feature: fix-agent-mcp-tools (bug fix)
  Regression guard for the defect report 2026-11-07-agent-mcp-tool-error-details-masked-defect:
  agent MCP tools hide every backend gRPC error message.

  @AC-1 @regression
  Scenario: A backend refusal reaches the MCP caller with its gRPC code and message
    Given the config backend refuses SetConfig with FAILED_PRECONDITION "ambiguous config key spelling: a and b both exist"
    When the caller invokes the set_config tool through the MCP server dispatch
    Then the tool result is an error whose text contains "FAILED_PRECONDITION" and "ambiguous config key spelling"
    And the text is not only "Error executing tool set_config"
