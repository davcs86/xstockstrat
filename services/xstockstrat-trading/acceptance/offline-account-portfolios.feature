# Promoted from docs/roadmap/features/157-offline-account-portfolios/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-157` tag.
# Durable business rules xstockstrat-trading already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. These cover the broker-less
# "offline" account (BROKER_TYPE_OFFLINE): its credential-free registration, its broker-free order
# recording + hand-confirmed fills, the poller skip, and the offline-only ConfirmOrder gate.

Feature: xstockstrat-trading — offline (broker-less) accounts
  What trading guarantees for an offline account whose orders are confirmed by hand: it registers
  with no credentials, records orders without ever contacting a broker, has its fills confirmed
  from the UI/agent, is skipped by every broker poller, and rejects ConfirmOrder for broker accounts.

  @AC-1 @FR-1 @feature-157
  Scenario: Create an offline account with no broker credentials
    Given a user with no offline account
    When the user creates an offline account named "My IRA (offline)" and supplies no credentials_json
    Then a new account is persisted with broker_type = BROKER_TYPE_OFFLINE
    And its credential-health status is not evaluated (credential_status = UNSPECIFIED)
    And ListBrokerAccounts returns it with broker_type = offline and is_active = true

  @AC-2 @FR-1 @feature-157
  Scenario: Registering an offline account does not require credentials
    Given the trading service rejects a broker (Alpaca) registration with empty credentials_json
    When the user registers an offline account with empty credentials_json
    Then registration succeeds
    And no encrypted-credential row is stored for that account (credentials_enc is NULL)

  @AC-4 @FR-3 @feature-157
  Scenario: Recording an offline order never contacts a broker
    Given an offline account "My IRA (offline)"
    When the user records a BUY order for 10 shares of "AAPL" against that account
    Then the order is persisted in trading.orders with account_id = the offline account and an empty broker_order_id
    And no broker SubmitOrder call is made
    And the order's initial status is NEW with filled_qty = 0

  @AC-5 @FR-4 @feature-157
  Scenario: Editing an offline order confirmation from the UI marks it filled
    Given a recorded offline BUY order for 10 shares of "AAPL" in status NEW
    When the user confirms the fill in the /trader UI with filled_qty = 10, filled_avg_price = 190.25, and filled_at = "2026-08-26T14:30:00Z"
    Then the order status becomes FILLED
    And GetOrder returns filled_qty = 10, filled_avg_price = 190.25, and filled_at = "2026-08-26T14:30:00Z"

  @AC-8 @FR-7 @feature-157
  Scenario: Broker pollers skip offline accounts
    Given an offline account and an Alpaca account are both active
    When the fill poller, position-sync poller, and credential-health poller run one cycle
    Then only the Alpaca account is polled against a broker client
    And the offline account is skipped with no broker client constructed for it

  @AC-9 @FR-8 @feature-157
  Scenario: Order-confirmation edits are rejected for broker accounts
    Given an Alpaca (broker) account with a working order in status NEW
    When a caller attempts to set that order's fill via the offline ConfirmOrder path
    Then the request is rejected with FailedPrecondition indicating confirmation applies only to offline accounts
    And the broker order's status and fill fields are unchanged
