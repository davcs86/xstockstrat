# Promoted from docs/roadmap/features/328-fix-agent-bearer-secret-orphan/acceptance.feature
# Source: @AC-4 - config scenario. @feature-328 marks provenance. Do not hand-author or rewrite.
Feature: fix-agent-bearer-secret-orphan (config)
  Regression guard for defect report: signal-source bearer secret is orphaned when the source
  register fails. Written for the operator's sweep ruling (2026-11-10): a failed register may leave the secret until the orphan sweep runs.

  # guards: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
  @AC-4 @regression @feature-328
  Scenario: the orphan sweep never deletes a referenced bearer secret
    Given user U has a registered mcp_client source whose credentials_ref is mcp_credential.<uuid-A>
    And an orphaned mcp_credential.<uuid-B> that no source references
    When the mcp_credential orphan sweep runs
    Then mcp_credential.<uuid-A> still exists and the source still authenticates
    And mcp_credential.<uuid-B> is deleted
