@feature-169
Feature: resume-halted-account (xstockstrat-trading)
  Operator-facing ResumeAccount RPC clears automated reconciliation or bracket-protection
  halts on broker accounts — auditable, authorized, no DBA intervention or restart.

  @AC-1 @FR-1 @FR-2 @feature-169
  Scenario: ResumeAccount clears persistent and in-memory halt state
    Given broker account "acct-1" is halted with halt_reason "unknown_broker_order: bo-xyz" and halt_source HALT_SOURCE_RECONCILIATION
    When an operator calls ResumeAccount with account_id "acct-1" and reason "false positive — terminal order misclassified"
    Then the broker_accounts row for "acct-1" has halted=false, halt_reason="", halted_at=NULL, halt_source=HALT_SOURCE_UNSPECIFIED
    And the in-memory brokerPool entry for "acct-1" has halted=false
    And the response contains the updated BrokerAccount with halted=false

  @AC-2 @FR-3 @feature-169
  Scenario: ResumeAccount emits a ledger event recording the un-halt
    Given broker account "acct-1" is halted with halt_reason "flatten_failure: AAPL" and halt_source HALT_SOURCE_BRACKET_PROTECTION
    When an operator with user_id "operator-1" calls ResumeAccount with account_id "acct-1" and reason "position manually closed"
    Then a ledger event with type "account.halt.resumed" is appended containing account_id "acct-1", operator "operator-1", prior_halt_reason "flatten_failure: AAPL", prior_halt_source "HALT_SOURCE_BRACKET_PROTECTION", and reason "position manually closed"

  @AC-3 @FR-4 @feature-169
  Scenario: ResumeAccount emits an INFO alert
    Given broker account "acct-1" is halted
    When an operator calls ResumeAccount with account_id "acct-1" and reason "investigated and cleared"
    Then an alert is emitted via xstockstrat-notify with severity INFO, type "account.halt.resumed", and message containing "acct-1" and "investigated and cleared"

  @AC-4 @FR-5 @feature-169
  Scenario: ResumeAccount rejects non-operator callers with PERMISSION_DENIED
    Given broker account "acct-1" is halted
    When a caller with x-access-scope "trader" calls ResumeAccount with account_id "acct-1"
    Then the RPC returns status PERMISSION_DENIED
    And the broker_accounts row for "acct-1" remains halted=true

  @AC-6 @FR-7 @feature-169
  Scenario: ResumeAccount on a non-halted account is a no-op
    Given broker account "acct-2" exists with halted=false
    When an operator calls ResumeAccount with account_id "acct-2" and reason "precautionary"
    Then the RPC returns success with the unchanged BrokerAccount
    And no ledger event of type "account.halt.resumed" is appended
    And no alert is emitted

  @AC-7 @FR-2 @feature-169
  Scenario: Reconciliation poller resumes ticking after ResumeAccount
    Given broker account "acct-1" was halted and is now resumed via ResumeAccount
    When the next reconciliation tick fires
    Then the poller processes "acct-1" normally (no skip due to halt)
