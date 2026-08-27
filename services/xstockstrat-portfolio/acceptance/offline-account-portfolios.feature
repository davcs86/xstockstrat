# Promoted from docs/roadmap/features/157-offline-account-portfolios/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-157` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. These cover how a confirmed
# offline fill reaches positions via the shared absolute-sync path (never order.filled), idempotent
# re-edits, sell-to-close/short, and the isolation of broker P&L from offline realized.

Feature: xstockstrat-portfolio — offline account positions & P&L
  What portfolio guarantees for offline accounts: a confirmed offline fill updates positions through
  the same account.positions.synced absolute-recompute path (not order.filled), re-editing a
  confirmation never double-counts, closes realize P&L into an account-grain row, and a broker
  account's figures are unaffected by the presence of an offline account.

  @AC-7 @FR-6 @feature-157
  Scenario: A confirmed offline fill updates positions via the shared absolute-sync path
    Given an offline account with no open positions
    When an offline BUY order for 10 shares of "AAPL" is confirmed filled at avg price 190.25
    Then an account.positions.synced event is emitted for that account_id carrying user_id and the environment trading_mode
    And no order.filled event is emitted for that account
    And the portfolio ListPositions result shows a 10-share AAPL position with avg_entry_price = 190.25 for that account
    And the same position's market_value and unrealized_pnl match between ListPositions and the ListPortfolios portfolio card

  @AC-10 @FR-6 @feature-157
  Scenario: Re-editing a confirmed offline fill does not double-count the position
    Given an offline BUY order for 10 shares of "AAPL" already confirmed filled at 190.25 (position = 10 shares)
    When the user edits the same order's confirmation to filled_avg_price = 191.00
    Then the AAPL position for that account remains 10 shares (not 20)
    And its avg_entry_price becomes 191.00

  @AC-11 @FR-6 @feature-157
  Scenario: A sell-to-close offline confirmation removes the position
    Given an offline account holding 10 shares of "AAPL" from a confirmed BUY at 190.25
    When the user records and confirms a SELL of 10 shares of "AAPL" at 200.00
    Then the AAPL position for that account is removed (net qty 0)
    And the account's realized P&L increases by 97.50

  @AC-12 @FR-6 @feature-157
  Scenario: A sell-to-open offline confirmation opens a short position
    Given an offline account with no "TSLA" position
    When the user records and confirms a SELL of 5 shares of "TSLA" at 250.00
    Then a short "TSLA" position of -5 shares with avg_entry_price = 250.00 is shown for that account
    And its unrealized_pnl reflects (250.00 - current_price) * 5

  @AC-14 @FR-6 @feature-157
  Scenario: A broker account's P&L is unaffected by the presence of an offline account
    Given a user with an Alpaca account and an offline account that has recorded realized P&L
    When the Alpaca account's portfolio card and P&L are read
    Then the Alpaca figures are identical to what they were with no offline account present
    And the offline realized value is not added to the broker account's totals
