Feature: offline-account-portfolios
  As a trader with holdings outside the platform's integrated brokers, I want an offline
  account whose orders I confirm by hand, so that its positions and P&L appear alongside my
  broker accounts using the same portfolio views.

  @AC-1 @FR-1
  Scenario: Create an offline account with no broker credentials
    Given a user with no offline account
    When the user creates an offline account named "My IRA (offline)" and supplies no credentials_json
    Then a new account is persisted with an offline account source
    And its credential-health status is not evaluated (no broker to validate against)
    And ListBrokerAccounts returns it with broker/provider = offline and is_active = true

  @AC-2 @FR-1
  Scenario: Registering an offline account does not require credentials
    Given the trading service rejects a broker (Alpaca) registration with empty credentials_json
    When the user registers an offline account with empty credentials_json
    Then registration succeeds
    And no encrypted-credential row is stored for that account

  @AC-3 @FR-2
  Scenario: Offline accounts appear alongside broker accounts in the account selector
    Given a user with one Alpaca account "alpaca-default" and one offline account "My IRA (offline)"
    When the /trader account selector loads
    Then both accounts are listed
    And selecting the offline account shows its portfolio card via ListPortfolios keyed by that account_id

  @AC-4 @FR-3
  Scenario: Recording an offline order never contacts a broker
    Given an offline account "My IRA (offline)"
    When the user records a BUY order for 10 shares of "AAPL" against that account
    Then the order is persisted in trading.orders with account_id = the offline account
    And no broker SubmitOrder call is made
    And the order's initial status is NEW with filled_qty = 0

  @AC-5 @FR-4
  Scenario: Editing an offline order confirmation from the UI marks it filled
    Given a recorded offline BUY order for 10 shares of "AAPL" in status NEW
    When the user confirms the fill in the /trader UI with filled_qty = 10, filled_avg_price = 190.25, and a fill time of "2026-08-26T14:30:00Z"
    Then the order status becomes FILLED
    And GetOrder returns filled_qty = 10 and filled_avg_price = 190.25

  @AC-6 @FR-5
  Scenario: Editing an offline order confirmation via the MCP agent tool
    Given a recorded offline BUY order for 10 shares of "AAPL" in status NEW
    When the MCP order-confirmation tool is called with filled_qty = 10 and filled_avg_price = 190.25
    Then the tool returns the updated order with status FILLED
    And the change is visible from GetOrder over gRPC

  @AC-7 @FR-6
  Scenario: A confirmed offline fill updates positions and P&L via the shared portfolio path
    Given an offline account with no open positions
    When an offline BUY order for 10 shares of "AAPL" is confirmed filled at avg price 190.25
    Then an order.filled ledger event is emitted for that account_id
    And the portfolio ListPositions result shows a 10-share AAPL position with avg_entry_price = 190.25 for that account
    And the same position's market_value and unrealized_pnl match between ListPositions and the ListPortfolios portfolio card

  @AC-8 @FR-7
  Scenario: Broker pollers skip offline accounts
    Given an offline account and an Alpaca account are both active
    When the fill poller, position-sync poller, and credential-health poller run one cycle
    Then only the Alpaca account is polled against a broker client
    And the offline account is skipped with no broker client constructed for it

  @AC-9 @FR-8
  Scenario: Order-confirmation edits are rejected for broker accounts
    Given an Alpaca (broker) account with a working order in status NEW
    When a caller attempts to set that order's fill via the offline order-confirmation path
    Then the request is rejected with an error indicating confirmation edits apply only to offline accounts
    And the broker order's status and fill fields are unchanged
