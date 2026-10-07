# Promoted from docs/roadmap/features/187-opportunities-pagination-drain/acceptance.feature at
# archive time (Constitution C-16). Source-feature provenance is carried on every scenario's
# `@feature-187` tag. Durable business rule xstockstrat-agent guarantees for the list_opportunities
# MCP tool: manual paging through page_token / next_page_token. A rule enters only by promotion from a
# reviewed feature acceptance.feature, never by hand-authoring.

Feature: opportunities-pagination-drain (agent guarantees)
  What the xstockstrat-agent list_opportunities MCP tool guarantees: callers can page through the
  whole queue manually with page_token and next_page_token.

  @AC-4 @FR-3 @feature-187
  Scenario: Agent tool exposes pagination params for manual paging
    Given 60 materialized opportunities exist for the user
    When the list_opportunities MCP tool is invoked with default params
    Then the tool returns up to 50 opportunities in rank order
    And the response includes next_page_token for the remaining rows
    When the tool is invoked again with the returned page_token
    Then the remaining 10 opportunities are returned
    And next_page_token is empty
