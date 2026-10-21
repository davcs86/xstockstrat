Feature: fix-ui-trader-feedback (bug fix)
  Regression guard for docs/reports/2026-10-21-ui-trader-feedback-defect.md:
  stale streamed order status (D-11), PAPER default while mode unknown (D-17),
  symbol-page backtest without strategyId (D-45), and silent action failures (D-64).

  @AC-1 @regression
  Scenario: A fresher polled terminal status wins over a stale streamed status
    Given order "o-1" was streamed with status PARTIALLY_FILLED and updatedAt 2026-10-21T10:00:00Z
    And the next poll returns order "o-1" with status FILLED and updatedAt 2026-10-21T10:00:05Z
    When the orders table renders
    Then order "o-1" shows status FILLED

  @AC-2 @regression
  Scenario: A dropped order stream is shown to the user and reconnects
    Given the trader is on "/trader/orders" with the order stream connected
    When the StreamOrderUpdates stream errors with UNAVAILABLE
    Then the page shows that live order updates are disconnected
    And the hook re-subscribes with backoff and clears the indicator once a new stream is open

  @AC-3 @regression
  Scenario: An order placed while the environment is unknown is not tagged PAPER
    Given GetTradingEnvironment fails so the environment mode is unknown
    When the trader submits a buy 1 "AAPL" market order from "/trader"
    Then the PlaceOrder request does not carry tradingMode PAPER
    And it either carries TRADING_MODE_UNSPECIFIED or order entry is blocked until the mode is known

  @AC-4 @regression
  Scenario: A symbol-page backtest earns evidence and appears in the strategy's history
    Given strategy "s-1" owned by the trader
    When the trader runs a backtest from "/trader/positions/AAPL?strategy=s-1"
    Then the RunBacktest request carries strategyId "s-1" and strategyIdRef "s-1"
    And the run appears in the backtest history of strategy "s-1"

  @AC-5 @regression
  Scenario: A failed opportunity action is shown to the user
    Given SetOpportunityAction fails with UNAVAILABLE
    When the user clicks "Snooze" on an opportunity on "/insights/opportunities"
    Then an error message is shown

  @AC-6 @regression
  Scenario: A failed signal-source toggle is shown to the user
    Given ManageSignalSource deactivate fails with UNAVAILABLE
    When the user deactivates source "newsletter-a" on "/insights/signal-sources"
    Then an error message is shown

  @AC-7 @regression
  Scenario: A failed ledger export is shown to the user
    Given "/trader/api/ledger/export" returns HTTP 500 or the request rejects
    When the user clicks the export events button on "/trader/portfolio"
    Then an error message is shown and no unhandled promise rejection occurs
