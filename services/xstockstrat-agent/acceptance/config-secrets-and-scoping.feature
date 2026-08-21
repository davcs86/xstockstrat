# Promoted from docs/roadmap/features/147-config-secrets-and-scoping/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-147` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.
#
# NOTE: the cross-cutting "MCP_AGENT_SECRET is absent from the codebase and deploy surfaces" scenario
# (@AC-8) is promoted to docs/sdd/business-rules/platform.feature, not here, because it spans service
# code AND the deploy pipeline.

Feature: xstockstrat-agent — OAuth txn signed with JWT_SECRET
  What the agent guarantees for its stateless OAuth transaction blob after MCP_AGENT_SECRET was
  removed and JWT_SECRET took over the HMAC signing role.

  @AC-9 @FR-7 @feature-147
  Scenario: The agent OAuth txn round-trips signed with JWT_SECRET
    Given the agent OAuth server signs its stateless txn blob with JWT_SECRET
    When an OAuth authorization flow issues a txn and then verifies it on the callback
    Then the txn signature verifies successfully
    And a txn tampered by one byte is rejected
    And a txn signed with a different key is rejected
