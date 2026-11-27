# Promoted from docs/roadmap/features/314-fix-mcp-deadline-budget/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-314` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: @AC-1 tests/test_extract_call_budget.py::test_ac1_extract_email_content_returns_partial_before_mcp_timeout;
# @AC-2 tests/test_list_opportunities_deadline.py::test_ac2_worst_case_at_setconfig_ceiling_stays_under_57s.

Feature: xstockstrat-agent — MCP tool calls answer inside the MCP client's timeout
  Agent tool calls must answer inside the MCP client's 60 s timeout.

  # guards: docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md
  @AC-1 @regression @feature-314
  Scenario: extract_email_content returns partial results before the MCP client timeout
    Given three URLs that each trickle bytes just inside the 30 s read timeout
    And a signal source without credentials
    When extract_email_content is called over MCP with those three URLs
    Then the tool returns in under 60 s
    And the response carries the texts gathered so far plus an error naming the URLs not fetched

  # guards: docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md
  # The tightened 44 / 57 s bar is asserted by test_ac2_worst_case_at_setconfig_ceiling_stays_under_57s.
  @AC-2 @regression @feature-314
  Scenario: list_opportunities worst case stays under the MCP client timeout
    Given agent.opportunities.read_timeout_seconds is set to its SetConfig ceiling
    And identity answers ValidateToken just inside its 10 s deadline
    And analysis ListOpportunities accepts the connection and never answers
    When list_opportunities is called over MCP
    Then the tool returns its upstream-deadline message in under 60 s
