# Promoted from docs/roadmap/features/227-fix-opportunities-read-hangs/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-227` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: @AC-2 tests/test_list_opportunities_deadline.py.

Feature: xstockstrat-agent — list_opportunities fails fast on a hung analysis read
  The agent puts a gRPC deadline on ListOpportunities so a hung upstream surfaces as an explicit
  deadline error before the MCP client's own limit.

  @AC-2 @regression @feature-227
  Scenario: A hung analysis read fails fast at the agent instead of hanging
    Given analysis "ListOpportunities" never responds
    When the agent tool "list_opportunities" is called
    Then it returns an error naming a deadline before the MCP client's 60-second limit
