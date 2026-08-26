# Promoted from docs/roadmap/features/157-offline-account-portfolios/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-157` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring. This covers editing an offline
# order confirmation through the MCP order-confirmation tool.

Feature: xstockstrat-agent — offline order confirmation via MCP
  What the agent guarantees for offline accounts: the MCP order-confirmation tool marks a recorded
  offline order filled and the change is visible over gRPC.

  @AC-6 @FR-5 @feature-157
  Scenario: Editing an offline order confirmation via the MCP agent tool
    Given a recorded offline BUY order for 10 shares of "AAPL" in status NEW
    When the MCP order-confirmation tool is called with filled_qty = 10 and filled_avg_price = 190.25
    Then the tool returns the updated order with status FILLED
    And the change is visible from GetOrder over gRPC
