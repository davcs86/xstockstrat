# Durable business-rule suite for xstockstrat-agent (Constitution C-16). Promoted from feature 156's
# acceptance.feature on code-completion; @feature-156 marks provenance. A rule enters only by
# promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent — run_fundamentals_scan MCP tool
  The agent exposes the admin-scoped fundamentals producer trigger, forwarding the caller's real
  derived scope so the analysis backend gate — not the tool — authorizes it.

  @AC-8 @feature-156
  Scenario: The MCP tool triggers a scan for an admin and rejects a non-admin
    Given the agent "run_fundamentals_scan" tool is invoked
    When the caller carries the admin access scope
    Then the tool forwards the caller's derived scope and the backend runs the scan
    And when the caller lacks the admin scope the backend rejects it with PERMISSION_DENIED
