# Promoted from docs/roadmap/features/319-fix-auth-trust-hardening/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-319` tag.
# Durable business rules xstockstrat-agent already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent - OAuth dynamic client registration fails closed
  /oauth/register does not widen registration while the registration policy cannot be read.
  Operator-signed (context.md, 2026-11-10): supersedes 247 @AC-4 (201 on a config stall).

  # guards: docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md
  @AC-3 @regression @feature-319
  Scenario: DCR is refused while the registration policy cannot be read
    Given agent.oauth.registration_enabled is "false"
    And the agent's read of the registration policy fails (no config snapshot for namespace "agent")
    When POST /oauth/register is sent with {"redirect_uris": ["https://attacker.example/cb"]}
    Then the response status is 503
    And no client_id is issued
