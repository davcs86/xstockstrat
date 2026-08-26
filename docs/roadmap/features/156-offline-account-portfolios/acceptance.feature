Feature: offline-account-portfolios
  As a trader with holdings outside the platform's integrated brokers, I want an offline
  account whose orders I confirm by hand, so that its positions and P&L appear alongside my
  broker accounts using the same portfolio views.

  @AC-1 @FR-1
  Scenario: Create an offline account with no broker credentials
    Given a user with no offline account
    When the user creates an offline account named "My IRA (offline)" and supplies no credentials_json
    Then a new account is persisted with broker_type = BROKER_TYPE_OFFLINE
    And its credential-health status is not evaluated (credential_status = UNSPECIFIED)
    And ListBrokerAccounts returns it with broker_type = offline and is_active = true

  @AC-2 @FR-1
  Scenario: Registering an offline account does not require credentials
    Given the trading service rejects a broker (Alpaca) registration with empty credentials_json
    When the user registers an offline account with empty credentials_json
    Then registration succeeds
    And no encrypted-credential row is stored for that account (credentials_enc is NULL)

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
    Then the order is persisted in trading.orders with account_id = the offline account and an empty broker_order_id
    And no broker SubmitOrder call is made
    And the order's initial status is NEW with filled_qty = 0

  @AC-5 @FR-4
  Scenario: Editing an offline order confirmation from the UI marks it filled
    Given a recorded offline BUY order for 10 shares of "AAPL" in status NEW
    When the user confirms the fill in the /trader UI with filled_qty = 10, filled_avg_price = 190.25, and filled_at = "2026-08-26T14:30:00Z"
    Then the order status becomes FILLED
    And GetOrder returns filled_qty = 10, filled_avg_price = 190.25, and filled_at = "2026-08-26T14:30:00Z"

  @AC-6 @FR-5
  Scenario: Editing an offline order confirmation via the MCP agent tool
    Given a recorded offline BUY order for 10 shares of "AAPL" in status NEW
    When the MCP order-confirmation tool is called with filled_qty = 10 and filled_avg_price = 190.25
    Then the tool returns the updated order with status FILLED
    And the change is visible from GetOrder over gRPC

  @AC-7 @FR-6
  Scenario: A confirmed offline fill updates positions via the shared absolute-sync path
    Given an offline account with no open positions
    When an offline BUY order for 10 shares of "AAPL" is confirmed filled at avg price 190.25
    Then an account.positions.synced event is emitted for that account_id carrying user_id and the environment trading_mode
    And no order.filled event is emitted for that account
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
    When a caller attempts to set that order's fill via the offline ConfirmOrder path
    Then the request is rejected with FailedPrecondition indicating confirmation applies only to offline accounts
    And the broker order's status and fill fields are unchanged

  @AC-10 @FR-6
  Scenario: Re-editing a confirmed offline fill does not double-count the position
    Given an offline BUY order for 10 shares of "AAPL" already confirmed filled at 190.25 (position = 10 shares)
    When the user edits the same order's confirmation to filled_avg_price = 191.00
    Then the AAPL position for that account remains 10 shares (not 20)
    And its avg_entry_price becomes 191.00

  @AC-11 @FR-6
  Scenario: A sell-to-close offline confirmation removes the position
    Given an offline account holding 10 shares of "AAPL" from a confirmed BUY at 190.25
    When the user records and confirms a SELL of 10 shares of "AAPL" at 200.00
    Then the AAPL position for that account is removed (net qty 0)
    And the account's realized P&L increases by 97.50

  @AC-12 @FR-6
  Scenario: A sell-to-open offline confirmation opens a short position
    Given an offline account with no "TSLA" position
    When the user records and confirms a SELL of 5 shares of "TSLA" at 250.00
    Then a short "TSLA" position of -5 shares with avg_entry_price = 250.00 is shown for that account
    And its unrealized_pnl reflects (250.00 - current_price) * 5

  @AC-13 @FR-6
  Scenario: Offline realized P&L survives a full position close and is shown on the account card
    Given an offline account whose only position was closed for a realized gain of 97.50
    When the /trader portfolio card for that offline account loads
    Then the card shows Realized P&L = 97.50 even though the account has no open positions

  @AC-14 @FR-6
  Scenario: A broker account's P&L is unaffected by the presence of an offline account
    Given a user with an Alpaca account and an offline account that has recorded realized P&L
    When the Alpaca account's portfolio card and P&L are read
    Then the Alpaca figures are identical to what they were with no offline account present
    And the offline realized value is not added to the broker account's totals

  @AC-15 @FR-1
  Scenario: Deregistering an offline account purges its positions and realized P&L
    Given an offline account with open positions and recorded realized P&L
    When the user deregisters that offline account
    Then an account.deregistered event is emitted for that account_id
    And the account's positions and its offline_account_realized row are removed
    And the account no longer appears in ListBrokerAccounts
