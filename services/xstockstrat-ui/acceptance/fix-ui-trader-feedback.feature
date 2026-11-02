# Promoted from docs/roadmap/features/270-fix-ui-trader-feedback/acceptance.feature (C-16). Do not hand-edit; provenance tags preserved.
Feature: fix-ui-trader-feedback (bug fix)
  Regression guard for docs/reports/2026-10-21-ui-trader-feedback-defect.md:
  stale streamed order status (D-11), PAPER default while mode unknown (D-17),
  symbol-page backtest without strategyId (D-45), and silent action failures (D-64).

  @AC-1 @FR-1 @regression @feature-270
  Scenario: A fresher polled terminal status wins over a stale streamed status
    Given order "o-1" was streamed with status PARTIALLY_FILLED and updatedAt 2026-10-21T10:00:00Z
    And the next poll returns order "o-1" with status FILLED and updatedAt 2026-10-21T10:00:05Z
    When the orders table renders
    Then order "o-1" shows status FILLED

  @AC-2 @FR-2 @regression @feature-270
  Scenario: A dropped order stream is shown to the user and reconnects
    Given the trader is on "/trader/orders" with the order stream connected
    When the StreamOrderUpdates stream errors with UNAVAILABLE
    Then the page shows that live order updates are disconnected
    When the order stream becomes available again and order "o-1" is then filled at the broker
    Then the disconnected indicator is no longer shown
    And order "o-1" shows status FILLED without a page reload

  @AC-3 @FR-3 @regression @feature-270
  Scenario: An order placed while the environment is unknown is not tagged PAPER
    Given GetTradingEnvironment fails so the environment mode is unknown
    When the trader submits a buy 1 "AAPL" market order from "/trader"
    Then the PlaceOrder request carries tradingMode TRADING_MODE_UNSPECIFIED
    And the page does not label the account or order entry as Paper

  @AC-4 @FR-4 @regression @feature-270
  Scenario: A symbol-page backtest earns evidence and appears in the strategy's history
    Given strategy "s-1" owned by the trader
    When the trader runs a backtest from "/trader/positions/AAPL?strategy=s-1"
    Then the RunBacktest request carries strategyId "s-1" and strategyIdRef "s-1"
    And the run appears in the backtest history of strategy "s-1"

  @AC-5 @FR-5 @regression @feature-270
  Scenario: A failed opportunity action is shown to the user
    Given SetOpportunityAction fails with UNAVAILABLE
    When the user clicks "Snooze" on an opportunity on "/insights/opportunities"
    Then an error message is shown

  @AC-6 @FR-5 @regression @feature-270
  Scenario: A failed signal-source toggle is shown to the user
    Given ManageSignalSource deactivate fails with UNAVAILABLE
    When the user deactivates source "newsletter-a" on "/insights/signal-sources"
    Then an error message is shown

  @AC-7 @FR-5 @regression @feature-270
  Scenario: A failed ledger export is shown to the user
    Given "/trader/api/ledger/export" returns HTTP 500
    When the user clicks the export events button on "/trader/portfolio"
    Then an error message is shown and no unhandled promise rejection occurs

  @AC-8 @FR-1 @regression @feature-270
  Scenario: An equal or older poll does not overwrite a streamed terminal status
    Given order "o-2" was streamed with status CANCELED and updatedAt 2026-10-21T10:00:05Z
    And the next poll returns order "o-2" with status NEW and updatedAt 2026-10-21T10:00:05Z
    When the orders table renders
    Then order "o-2" shows status CANCELED

  @AC-9 @FR-2 @regression @feature-270
  Scenario: A dropped alert stream is shown to the user and reconnects
    Given the trader is on "/trader" with the alert stream connected
    When the alert stream errors with UNAVAILABLE
    Then the page shows that live alerts are disconnected
    When the alert stream becomes available again and a new alert is emitted
    Then the disconnected indicator is no longer shown
    And the new alert is shown without a page reload

  @AC-10 @FR-5 @regression @feature-270
  Scenario: A failed mutation with no per-call error handler still shows an error
    Given a mutation that declares no onError handler
    When the mutation fails with UNAVAILABLE
    Then the global mutation error fallback shows an error message
    And no unhandled promise rejection occurs

  @AC-11 @FR-5 @regression @feature-270
  Scenario: A ledger export whose request rejects is shown to the user
    Given the request to "/trader/api/ledger/export" rejects with a network error
    When the user clicks the export events button on "/trader/portfolio"
    Then an error message is shown and no unhandled promise rejection occurs

  @AC-12 @FR-3 @regression @feature-270
  Scenario Outline: No trader page labels the account as Paper while the environment is unknown
    Given GetTradingEnvironment fails so the environment mode is unknown
    When the trader opens "<page>"
    Then the page does not label the account or order entry as Paper

    Examples:
      | page                   |
      | /trader                |
      | /trader/orders         |
      | /trader/positions      |
      | /trader/positions/AAPL |
      | /trader/portfolio      |
