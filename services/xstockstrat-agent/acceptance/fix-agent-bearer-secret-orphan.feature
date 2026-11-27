# Promoted from docs/roadmap/features/328-fix-agent-bearer-secret-orphan/acceptance.feature
# Source: @AC-1, @AC-2 - agent scenarios. @feature-328 marks provenance. Do not hand-author or rewrite.
Feature: fix-agent-bearer-secret-orphan (agent)
  Regression guard for defect report: signal-source bearer secret is orphaned when the source
  register fails. Written for the operator's sweep ruling (2026-11-10): a failed register may leave the secret until the orphan sweep runs.

  # guards: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
  @AC-1 @regression @feature-328
  Scenario: a failed manage_signal_source register leaves no unreferenced bearer secret
    Given user U already has a signal source with slug "dup-src"
    When U calls manage_signal_source register with source_type "mcp_client", a bearer_token and slug "dup-src"
    And ingest rejects the register with ALREADY_EXISTS
    And U retries the same call twice
    Then each call returns the mapped already-exists error
    And after the mcp_credential orphan sweep runs, list_config_keys namespace "ingest" for U shows no mcp_credential.<uuid> key that no source's credentials_ref references

  # guards: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
  @AC-2 @regression @feature-328
  Scenario: a failed instantiate_template signal_source leaves no unreferenced bearer secret
    Given user U already has a signal source with slug "dup-src"
    When U calls instantiate_template with kind "signal_source", a bearer_token and slug "dup-src"
    And ingest rejects the instantiation with ALREADY_EXISTS
    Then the call returns the mapped already-exists error
    And after the mcp_credential orphan sweep runs, list_config_keys namespace "ingest" for U shows no mcp_credential.<uuid> key that no source's credentials_ref references
