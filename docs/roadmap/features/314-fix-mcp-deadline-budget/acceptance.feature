Feature: fix-mcp-deadline-budget (bug fix)
  Regression guard for clustered defect reports: agent tool calls must answer inside the MCP client's 60 s
  timeout, and SetConfig must not accept timeout values that invert cross-hop deadline ordering.

  # guards: docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md
  @AC-1 @regression
  Scenario: extract_email_content returns partial results before the MCP client timeout
    Given three URLs that each trickle bytes just inside the 30 s read timeout
    And a signal source without credentials
    When extract_email_content is called over MCP with those three URLs
    Then the tool returns in under 60 s
    And the response carries the texts gathered so far plus an error naming the URLs not fetched

  # guards: docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md
  @AC-2 @regression
  Scenario: list_opportunities worst case stays under the MCP client timeout
    Given agent.opportunities.read_timeout_seconds is set to its SetConfig ceiling
    And identity answers ValidateToken just inside its 10 s deadline
    And analysis ListOpportunities accepts the connection and never answers
    When list_opportunities is called over MCP
    Then the tool returns its upstream-deadline message in under 60 s

  # guards: docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md
  @AC-3 @regression
  Scenario: SetConfig rejects a value that inverts portfolio-over-marketdata quote deadline ordering
    Given portfolio.marketdata.quote_timeout_ms is 1000
    When SetConfig writes marketdata.quotes.batch_timeout_ms = 5000
    Then the write is rejected with INVALID_ARGUMENT
    And the stored marketdata.quotes.batch_timeout_ms is unchanged
