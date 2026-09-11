# Promoted from docs/roadmap/features/095-opportunity-live-market-enrichment/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-095`
# tag. Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: opportunity-live-market-enrichment
  What the xstockstrat-agent list_opportunities MCP tool guarantees: it surfaces the same
  marketdata-backed live enrichment the UI reads, and omits an absent target/stop rather than
  fabricating a zero value.

  @AC-15 @FR-9 @FR-6 @feature-095
  Scenario: The agent list_opportunities tool surfaces the enrichment and omits an absent target
    Given the ranked opportunities queue holds "CAPR" whose latest marketdata trade is 12.34 and whose attributed strategy carries no target and no stop
    When the AI agent calls the read-only "list_opportunities" MCP tool
    Then the returned "CAPR" opportunity includes live_price 12.34 (sourced from the same marketdata-backed field the UI reads), and it omits target_price and stop_price entirely rather than returning a fabricated or zero value
