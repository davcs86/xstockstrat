# Business-rule suite: xstockstrat-agent — agent-broker-account-tools
# Promoted from docs/roadmap/features/164-agent-broker-account-tools/acceptance.feature
# by /sdd-archiver on 2026-08-31 per Constitution C-16.

Feature: agent broker-account management tools
  As an authenticated agent user, I want MCP tools to manage my broker accounts and list all my
  accounts, so that I can manage my trading accounts conversationally without leaving the agent.

  @AC-1 @feature-164 @FR-1
  Scenario: Register an Alpaca broker account
    Given an authenticated caller with user_id "user-42"
    When they call manage_account with operation "register", display_name "My Alpaca", broker_type "alpaca", and credentials_json "{\"api_key\":\"AK123\",\"api_secret\":\"SEC456\"}"
    Then the trading backend receives a RegisterBrokerAccount call with broker_type BROKER_TYPE_ALPACA, credentials_json "{\"api_key\":\"AK123\",\"api_secret\":\"SEC456\"}", and x-user-id "user-42"
    And the tool returns {"account": {...}} whose account has an "id", display_name "My Alpaca", and a "credential_status" field
    And the returned payload does not contain "api_key", "api_secret", or "credentials_json"

  @AC-2 @feature-164 @FR-1
  Scenario: Register rejects a missing broker type
    Given an authenticated caller with user_id "user-42"
    When they call manage_account with operation "register", display_name "My Alpaca", broker_type "", and credentials_json "{}"
    Then the tool raises a ValueError naming broker_type (and 'alpaca'/'ibkr') as required
    And no RegisterBrokerAccount call is made

  @AC-3 @feature-164 @FR-1
  Scenario: Register rejects the offline broker type
    Given an authenticated caller with user_id "user-42"
    When they call manage_account with operation "register", display_name "Manual book", broker_type "offline", and credentials_json ""
    Then the tool raises a ValueError directing the caller to manage_offline_account
    And no RegisterBrokerAccount call is made

  @AC-4 @feature-164 @FR-2
  Scenario: Rotate a broker account's credentials
    Given an authenticated caller with user_id "user-42" who owns account "acct-7"
    When they call manage_account with operation "update_credentials", account_id "acct-7", and credentials_json "{\"api_key\":\"AKnew\",\"api_secret\":\"SECnew\"}"
    Then the trading backend receives an UpdateBrokerAccountCredentials call with account_id "acct-7" and x-user-id "user-42"
    And the tool returns {"account": {...}} for "acct-7"
    And the returned payload does not contain "api_key", "api_secret", or "credentials_json"

  @AC-5 @feature-164 @FR-3
  Scenario: Deregister a broker account
    Given an authenticated caller with user_id "user-42" who owns account "acct-7"
    When they call manage_account with operation "deregister" and account_id "acct-7"
    Then the trading backend receives a DeregisterBrokerAccount call with account_id "acct-7" and x-user-id "user-42"
    And the tool returns {"deregistered": true, "account_id": "acct-7"}

  @AC-6 @feature-164 @FR-4
  Scenario: List all of the caller's accounts, broker and offline together
    Given an authenticated caller with user_id "user-42" who owns an Alpaca account "acct-7" and an offline account "acct-9"
    When they call list_accounts
    Then the trading backend receives a ListBrokerAccounts call with x-user-id "user-42"
    And the tool returns {"accounts": [...]} containing "acct-7" with broker_type "BROKER_TYPE_ALPACA" and "acct-9" with broker_type "BROKER_TYPE_OFFLINE"

  @AC-7 @feature-164 @FR-5
  Scenario: A caller cannot act on an account they do not own
    Given an authenticated caller with user_id "user-99" who does not own account "acct-7"
    When they call manage_account with operation "deregister" and account_id "acct-7"
    And the trading backend rejects the DeregisterBrokerAccount call with gRPC PERMISSION_DENIED
    Then the tool raises a RuntimeError conveying the permission denial

  @AC-8 @feature-164 @FR-6
  Scenario: Unknown operation is rejected
    Given an authenticated caller with user_id "user-42"
    When they call manage_account with operation "delete_everything"
    Then the tool raises a ValueError listing the expected operations register/update_credentials/deregister
    And no trading backend call is made
