# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (trading)

  @AC-1 @FR-1 @feature-294
  Scenario: Trading counts a flatten whose position lookup errored, separately from a flat position
    Given bracket order "ord-1" on account "acc-1" whose protection window has expired
    And the portfolio GetPosition call returns UNAVAILABLE
    When flattenAndHalt runs
    Then "trading.flatten.outcome" with outcome "lookup_error" increases by 1
    And "trading.flatten.outcome" with outcome "flat" does not change
    And the "flattenAndHalt: position lookup failed" log line has level ERROR
    And no metric attribute carries "ord-1" or "acc-1"

  @AC-2 @FR-1 @feature-294
  Scenario: Trading counts a flat position as expected, not as an error
    Given bracket order "ord-2" whose protection window has expired
    And the portfolio GetPosition call returns Qty 0
    When flattenAndHalt runs
    Then "trading.flatten.outcome" with outcome "flat" increases by 1
    And the "flattenAndHalt: no open position to flatten" log line has level INFO

  @AC-3 @FR-1 @feature-294
  Scenario: Trading counts a bracket lookup failure without creating a row
    Given a filled auto-sized entry "ord-3" with stopPrice greater than 0 and bracket orders enabled
    And GetBracketByOrderID returns a database error
    When maybeSubmitBracket runs
    Then "trading.bracket.outcome" with outcome "lookup_failed" increases by 1
    And no order_brackets row is inserted for "ord-3"
    And no alert is emitted by this branch

  @AC-4 @FR-1 @feature-294
  Scenario: Trading counts a ledger emit that fails after the Unavailable retry
    Given the ledger AppendEvent returns UNAVAILABLE on both attempts (appendMaxAttempts) for event type "order.filled"
    When emitLedgerEvent runs for stream "ord-4"
    Then "trading.ledger_emit" with event_type "order.filled" and outcome "failed" increases by 1
    And the "ledger emit failed" log carries stream_key "ord-4"
    And when AppendEvent instead returns UNAVAILABLE once and then succeeds, outcome "retried_ok" increases by 1

  @AC-5 @FR-1 @feature-294
  Scenario: Trading records the broker submit outcome as a bounded value
    Given an Alpaca account and the broker SubmitOrder returns a definite rejection "insufficient buying power"
    When the order is submitted
    Then "trading.order_submit" with broker_type "ALPACA" and outcome "rejected" increases by 1
    And no metric attribute contains the text "insufficient buying power"

  @AC-6 @FR-2 @feature-294
  Scenario: A loop writes one record per successful tick and none for a failed tick
    Given the trading fill poller with one candidate order and an injected clock ("now" on TradingService)
    When pollFills runs twice, and the fake GetOrder advances the clock 120 ms and returns non-terminal status "new" on call 1 and returns a broker error on call 2
    Then exactly 1 INFO record "loop tick ok" is written, with loop "fill_poller" and duration_ms 120
    And no "loop tick ok" record is written for call 2, while the WARN "fill poll: broker GetOrder failed" is written
    And pollFills calls no sleep: the injected clock advances only through the fake
    And the diff of trading.go has no hunk inside StartFillPoller

  @AC-45 @FR-1 @feature-294
  Scenario: Repeated systemic escalation is countable and the broker label covers IBKR
    Given 3 consecutive reconciliation ticks with systemic_threshold_pct 0.5 where 2 of 4 accounts error
    And an IBKR account whose SubmitOrder returns an uncertain-outcome timeout
    When escalateSystemic runs on each of the 3 ticks and the IBKR order is submitted
    Then "trading.escalation.systemic" increases by 3
    And "trading.order_submit" with broker_type "IBKR" and outcome "uncertain" increases by 1
    And fill handling for a PARTIALLY_FILLED then FILLED order is unchanged

  @AC-57 @FR-1 @feature-294
  Scenario: Trading counts a NotFound position lookup as flat
    Given bracket order "ord-57" whose protection window has expired
    And the portfolio GetPosition call returns gRPC NOT_FOUND
    When flattenAndHalt runs
    Then "trading.flatten.outcome" with outcome "flat" increases by 1
    And "trading.flatten.outcome" with outcome "lookup_error" does not change
    And the "flattenAndHalt: no open position to flatten" line has level INFO

  @AC-59 @FR-1 @feature-294
  Scenario: Position sync still counts an account whose ledger emit failed
    Given the ledger AppendEvent fails with UNAVAILABLE on both attempts for event type "account.positions.synced"
    When syncPositions runs for account "acc-59"
    Then the "position sync cycle complete" heartbeat still counts that account in accounts_synced
    And "trading.ledger_emit" with event_type "account.positions.synced" and outcome "failed" increases by 1
