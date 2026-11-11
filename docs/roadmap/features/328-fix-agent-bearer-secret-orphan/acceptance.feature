Feature: fix-agent-bearer-secret-orphan (bug fix)
  Regression guard for defect report: signal-source bearer secret is orphaned when the source
  register fails. Written for the operator's sweep ruling (2026-11-10): a failed register may leave the secret until the orphan sweep runs.

  # guards: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
  @AC-1 @regression
  Scenario: a failed manage_signal_source register leaves no unreferenced bearer secret
    Given user U already has a signal source with slug "dup-src"
    When U calls manage_signal_source register with source_type "mcp_client", a bearer_token and slug "dup-src"
    And ingest rejects the register with ALREADY_EXISTS
    And U retries the same call twice
    Then each call returns the mapped already-exists error
    And after the mcp_credential orphan sweep runs, list_config_keys namespace "ingest" for U shows no mcp_credential.<uuid> key that no source's credentials_ref references

  # guards: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
  @AC-2 @regression
  Scenario: a failed instantiate_template signal_source leaves no unreferenced bearer secret
    Given user U already has a signal source with slug "dup-src"
    When U calls instantiate_template with kind "signal_source", a bearer_token and slug "dup-src"
    And ingest rejects the instantiation with ALREADY_EXISTS
    Then the call returns the mapped already-exists error
    And after the mcp_credential orphan sweep runs, list_config_keys namespace "ingest" for U shows no mcp_credential.<uuid> key that no source's credentials_ref references

  # guards: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
  @AC-3 @regression
  Scenario: a failed config-ui signal-source register leaves no unreferenced bearer secret
    Given user U already has a signal source with slug "dup-src"
    When U registers an mcp_client source with a bearer token and slug "dup-src" from the config-ui
    And ingest rejects the register
    Then the config-ui shows the register error
    And after the mcp_credential orphan sweep runs, no mcp_credential.<uuid> key under namespace "ingest" for U is left unreferenced by any source

  # guards: docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md
  @AC-4 @regression
  Scenario: the orphan sweep never deletes a referenced bearer secret
    Given user U has a registered mcp_client source whose credentials_ref is mcp_credential.<uuid-A>
    And an orphaned mcp_credential.<uuid-B> that no source references
    When the mcp_credential orphan sweep runs
    Then mcp_credential.<uuid-A> still exists and the source still authenticates
    And mcp_credential.<uuid-B> is deleted
