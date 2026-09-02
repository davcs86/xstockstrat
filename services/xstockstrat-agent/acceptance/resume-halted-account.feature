@feature-169
Feature: resume-halted-account (xstockstrat-agent)
  The manage_account MCP tool's resume operation invokes ResumeAccount via the agent,
  gated by admin scope.

  @AC-5 @FR-6 @feature-169
  Scenario: manage_account resume operation invokes ResumeAccount via the agent
    Given broker account "acct-1" is halted with halt_reason "unknown_broker_order: bo-abc"
    When an admin calls manage_account with operation "resume", account_id "acct-1", and reason "false positive after PR #1067 fix"
    Then the tool calls the ResumeAccount RPC with account_id "acct-1" and reason "false positive after PR #1067 fix"
    And the tool returns a success response containing account_id "acct-1" and halted=false
