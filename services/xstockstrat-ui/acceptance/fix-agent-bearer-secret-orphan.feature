# Promoted from docs/roadmap/features/328-fix-agent-bearer-secret-orphan/acceptance.feature
# Source: @AC-3 - ui scenario. @feature-328 marks provenance. Do not hand-author or rewrite.
Feature: fix-agent-bearer-secret-orphan (ui)
  Regression guard for defect report: signal-source bearer secret is orphaned when the source
  register fails. Written for the operator's sweep ruling (2026-11-10): a failed register may leave the secret until the orphan sweep runs.

  # guards: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
  @AC-3 @regression @feature-328
  Scenario: a failed config-ui signal-source register leaves no unreferenced bearer secret
    Given user U already has a signal source with slug "dup-src"
    When U registers an mcp_client source with a bearer token and slug "dup-src" from the config-ui
    And ingest rejects the register
    Then the config-ui shows the register error
    And after the mcp_credential orphan sweep runs, no mcp_credential.<uuid> key under namespace "ingest" for U is left unreferenced by any source
