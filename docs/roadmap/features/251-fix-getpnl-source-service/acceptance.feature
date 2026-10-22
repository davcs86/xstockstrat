Feature: fix-getpnl-source-service (bug fix)
  Regression guard for docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md:
  GetPnL queries ledger fills with source_service "trading", but trading writes "xstockstrat-trading";
  and trading's fill payloads carry unsigned qty/filled_qty with no side key, so a sell folds as a buy.
  The /trader/positions fill lineage (services/xstockstrat-ui/src/hooks/usePositionLineage.ts:16-20) has the same filter bug.
  Every Given pins the producer's real payload: order.filled per services/xstockstrat-trading/internal/service/trading.go:1805-1812,
  order.partially_filled per :1822-1829, order.created per :649-652 (stream_key = order id, side on this event only).

  @AC-1 @FR-1 @FR-2 @regression
  Scenario: Realized P&L folds a sell that trading wrote with an unsigned qty
    Given a ledger that filters QueryEvents by exact source_service match
    And every event below has source_service "xstockstrat-trading" and user_id "u-1"
    And order "o-buy" has an "order.created" event with stream_key "o-buy" and payload symbol "AAPL", side "ORDER_SIDE_BUY", qty 10
    And order "o-sell" has an "order.created" event with stream_key "o-sell" and payload symbol "AAPL", side "ORDER_SIDE_SELL", qty 10
    And order "o-buy" has an "order.filled" event with payload order_id "o-buy", symbol "AAPL", qty 10, fill_price 100.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And order "o-sell" has a later "order.filled" event with payload order_id "o-sell", symbol "AAPL", unsigned qty 10, fill_price 150.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00

  @AC-2 @FR-1 @FR-2 @regression
  Scenario: A partially filled sell that trading wrote with an unsigned filled_qty is included in realized P&L
    Given a ledger that filters QueryEvents by exact source_service match
    And every event below has source_service "xstockstrat-trading" and user_id "u-1"
    And order "o-buy" has an "order.created" event with stream_key "o-buy" and payload symbol "AAPL", side "ORDER_SIDE_BUY", qty 10
    And order "o-sell" has an "order.created" event with stream_key "o-sell" and payload symbol "AAPL", side "ORDER_SIDE_SELL", qty 10
    And order "o-buy" has an "order.filled" event with payload order_id "o-buy", symbol "AAPL", qty 10, fill_price 100.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And order "o-sell" has a later "order.partially_filled" event with payload order_id "o-sell", symbol "AAPL", unsigned cumulative filled_qty 4, fill_price 150.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And order "o-sell" has no "order.filled" event
    When GetPnL runs for user "u-1"
    Then realized_pnl is 200.00

  @AC-3 @FR-3 @regression
  Scenario: The position fill lineage lists the trader's own fills that trading wrote to the ledger
    Given a ledger that filters QueryEvents by exact source_service match
    And the ledger holds an "order.filled" event with source_service "xstockstrat-trading" and payload order_id "o-buy", symbol "AAPL", qty 10, fill_price 100.00, account_id "acct-1", user_id "u-1", trading_mode "TRADING_MODE_PAPER"
    And the ledger holds an "order.filled" event with source_service "xstockstrat-trading" and payload order_id "o-other", symbol "AAPL", qty 5, fill_price 120.00, account_id "acct-2", user_id "u-2", trading_mode "TRADING_MODE_PAPER"
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then the Fill lineage table lists order "o-buy" with qty 10 and fill price 100.00
    And the ledger events returned to u-1's browser include none with user_id "u-2"

  # Appended 2026-10-21 by /sdd-spec from design.md §6F (C-15 append owed at design write). IDs are append-only.

  @AC-4 @FR-2 @regression
  Scenario: A caller's fill whose side cannot be resolved refuses GetPnL instead of fabricating a figure
    Given a ledger that filters QueryEvents by exact source_service and stream_key match
    And user "u-1" has an "order.filled" event with payload order_id "o-orphan", symbol "AAPL", unsigned qty 10, fill_price 100.00, user_id "u-1", trading_mode "TRADING_MODE_PAPER", and no side key
    And the ledger holds no "order.created" or "order.submitted" event with stream_key "o-orphan"
    When GetPnL runs for user "u-1"
    Then the RPC returns FAILED_PRECONDITION
    And no P&L figure is returned

  @AC-5 @FR-4 @regression
  Scenario: Another user's unresolvable fill does not affect the caller and costs no side lookup
    Given a ledger that filters QueryEvents by exact source_service and stream_key match
    And user "u-1" has an "order.filled" buy 10 AAPL @ 100.00 and a later "order.filled" sell 10 AAPL @ 150.00, each payload carrying side, account_id "acct-1", trading_mode "TRADING_MODE_PAPER"
    And user "u-2" has an "order.filled" event for order "o-u2" with no side key and no "order.created" or "order.submitted" sibling
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00
    And the ledger received no QueryEvents call with stream_key "o-u2"

  @AC-6 @FR-5 @regression
  Scenario: A ledger read failure mid-drain returns UNAVAILABLE, never a partial realized figure
    Given the ledger answers the first "order.filled" page with a next page token
    And the ledger fails the QueryEvents call for the next page
    When GetPnL runs for user "u-1"
    Then the RPC returns UNAVAILABLE

  @AC-7 @FR-5 @regression
  Scenario Outline: The caller's own deadline or cancellation maps to its own status code
    Given the ledger QueryEvents call <behaviour>
    When GetPnL runs for user "u-1" through the gRPC adapter
    Then the RPC returns <code>
    And the ledger received at least one QueryEvents call

    Examples:
      | behaviour                                        | code              |
      | blocks until the caller's deadline expires       | DEADLINE_EXCEEDED |
      | sees the caller cancel its context mid-call      | CANCELED          |

  @AC-8 @FR-5 @regression
  Scenario Outline: A replaying ledger fails GetPnL closed
    Given the ledger answers "order.filled" QueryEvents with <replay>
    When GetPnL runs for user "u-1"
    Then the RPC returns UNAVAILABLE

    Examples:
      | replay                                              |
      | the same next page token twice                      |
      | an event_id already returned on an earlier page     |
      | an empty page that still carries a next page token  |

  @AC-9 @FR-5 @regression
  Scenario: More than one page of fills folds every fill exactly once
    Given user "u-1" has 501 "order.filled" events whose payloads carry side
    And GetPnL requests "order.filled" pages of 500
    When GetPnL runs for user "u-1"
    Then each of the 501 fills is folded exactly once
    And the ledger received exactly 2 "order.filled" QueryEvents calls

  @AC-10 @FR-1 @FR-2 @regression
  Scenario Outline: Trading's fill events carry the order side, the canonical source_service and the fee
    Given a SELL order "ord-1" for 10 AAPL on an ALPACA account
    And the broker reports the order <broker_status>
    When the CancelOrder not-cancelable path adopts the broker status
    Then the ledger receives one "<event_type>" event with source_service "xstockstrat-trading" and stream_key "ord-1"
    And its payload carries side "ORDER_SIDE_SELL", the unsigned "<qty_key>" and the "fees" key

    Examples:
      | broker_status        | event_type             | qty_key    |
      | filled 10            | order.filled           | qty        |
      | partially_filled 4   | order.partially_filled | filled_qty |

  @AC-11 @FR-2 @regression
  Scenario: A fill whose payload carries side folds without a sibling lookup
    Given user "u-1" has an "order.filled" buy 10 AAPL @ 100.00 and a later "order.filled" sell 10 AAPL @ 150.00, each payload carrying side
    And the ledger holds no "order.created" or "order.submitted" event for either order
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00
    And the ledger received no QueryEvents call with a stream_key

  @AC-12 @FR-5 @regression
  Scenario: The ledger pages QueryEvents exactly once per event, including recorded_at ties
    Given a TimescaleDB ledger holding 7 events with one recorded_at and one source_service
    When a client drains QueryEvents filtered by that source_service with page size 3, following next_page_token
    Then it receives at least 2 pages
    And it receives every event_id exactly once, ordered by recorded_at then event_id

  @AC-13 @FR-5 @regression
  Scenario: A malformed page_token is rejected
    Given a QueryEvents request whose page_token does not decode to a ledger cursor
    When the ledger serves QueryEvents
    Then it returns INVALID_ARGUMENT

  @AC-14 @FR-4 @regression
  Scenario: Fills on different accounts do not net against each other
    Given user "u-1" buys 10 AAPL @ 100.00 on account "acct-1"
    And user "u-1" buys 10 AAPL @ 120.00 on account "acct-2"
    And user "u-1" later sells 10 AAPL @ 150.00 on account "acct-1"
    And every fill is an "order.filled" event with trading_mode "TRADING_MODE_PAPER" and a resolvable side
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00

  @AC-15 @FR-4 @regression
  Scenario: A symbol group mixing fills with and without account_id is refused
    Given user "u-1" has an AAPL "order.filled" with account_id "acct-1" and an AAPL "order.filled" with an empty account_id, both TRADING_MODE_PAPER
    When GetPnL runs for user "u-1"
    Then the RPC returns FAILED_PRECONDITION

  @AC-16 @FR-2 @regression
  Scenario Outline: Fills fold in ledger sequence order whatever order the ledger returns them in
    Given user "u-1" has <fills>
    And the ledger returns the events in the order <slice_order>
    When GetPnL runs for user "u-1" <runs>
    Then realized_pnl is 200.00 on every run

    Examples:
      | fills                                                                                                                                      | slice_order | runs                                        |
      | order A filled buy 10 @ 100.00 (seq 1), order S partial-only sell 4 @ 150.00 (seq 2), order B filled buy 10 @ 200.00 (seq 3)               | A,S,B       | once                                        |
      | order A partial-only buy 10 @ 100.00 (seq 1), order S partial-only sell 4 @ 150.00 (seq 2), order B partial-only buy 10 @ 200.00 (seq 3)   | A,B,S       | 20 times, each on a fresh service and ledger |

  @AC-17 @FR-2 @regression
  Scenario: A partially filled sell that later fills folds once, from its order.filled event
    Given user "u-1" has an "order.filled" buy 10 AAPL @ 100.00 for order "o-buy"
    And order "o-sell" (side "ORDER_SIDE_SELL") has an "order.partially_filled" with cumulative filled_qty 4 @ 150.00
    And order "o-sell" later has an "order.filled" with qty 10 @ 150.00
    When GetPnL runs for user "u-1"
    Then realized_pnl is 500.00

  @AC-18 @FR-4 @FR-3 @regression
  Scenario: A LIVE fill is excluded from paper GetPnL and from the paper fill lineage
    Given user "u-1" has a paper AAPL round trip buy 10 @ 100.00 then sell 10 @ 150.00 on account "acct-1"
    And user "u-1" has a LIVE AAPL "order.filled" sell 10 @ 300.00 on account "acct-1"
    When GetPnL runs for user "u-1" with trading_mode TRADING_MODE_PAPER
    Then realized_pnl is 500.00
    And the paper-mode Fill lineage for the "AAPL" position on account "acct-1" does not list the LIVE fill

  @AC-19 @FR-3 @regression
  Scenario: The fill lineage finds the trader's fill even when it is not in the first platform-wide page
    Given the ledger holds 100 "order.filled" events from other users recorded before u-1's fill for order "o-buy"
    And user "u-1" has order "o-buy" for AAPL on account "acct-1" in paper mode
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then the Fill lineage table lists order "o-buy"

  @AC-20 @FR-3 @regression
  Scenario: The BFF drops another user's fill events even when the browser asks for their stream key
    Given the ledger holds an "order.filled" event with stream_key "o-other" and payload user_id "u-2"
    When user "u-1" calls the trader BFF QueryEvents with stream_key "o-other" and event_type "order.filled"
    Then the response contains no event with payload user_id "u-2"

  @AC-21 @FR-3 @regression
  Scenario: The fill lineage caps at 50 orders and says so
    Given user "u-1" has 51 orders for AAPL on account "acct-1" in paper mode
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then fill events are queried for at most 50 orders
    And the sheet shows a notice that the lineage is truncated

  @AC-22 @FR-3 @regression
  Scenario: A fill whose order row still shows a non-filled status is listed
    Given user "u-1" has order "o-stale" for AAPL on account "acct-1" whose ListOrders status is NEW
    And the ledger holds an "order.filled" event for "o-stale" with payload user_id "u-1"
    When user "u-1" opens the "AAPL" position on account "acct-1" in /trader/positions in paper mode
    Then the Fill lineage table lists order "o-stale"
