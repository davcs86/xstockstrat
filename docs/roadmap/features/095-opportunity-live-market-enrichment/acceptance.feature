Feature: opportunity-live-market-enrichment
  As a trader on the Decide surface, I want each opportunity and the Signal-detail page to show
  live market context — current price/change, a sparkline, per-condition values, target/stop
  levels on the chart, and risk:reward + suggested sizing on the ticket — each degrading
  gracefully (omitted, never fabricated) so I can judge and size a signal without leaving the queue.

  @AC-1 @FR-1
  Scenario: An Opportunities queue card shows live price and change%
    Given an Opportunities queue card for "CAPR" whose latest marketdata trade is 12.34 and whose prior close was 12.09
    When the Opportunities queue renders the "CAPR" card
    Then the card shows the live price "12.34" and an intraday change of "+2.1%"

  @AC-2 @FR-1
  Scenario: The Signal-detail header shows live price and change%
    Given the trader opens the Signal-detail page "/insights/market/CAPR" whose latest marketdata trade is 12.34 and prior close 12.09
    When the Signal-detail header renders
    Then the header shows the live price "12.34" and the intraday change "+2.1%"

  @AC-3 @FR-2
  Scenario: A queue card renders a price sparkline from recent bars
    Given an Opportunities queue card for "CAPR" whose marketdata returns 20 recent bars
    When the "CAPR" card renders
    Then a compact sparkline plots those 20 bar closes in order

  @AC-4 @FR-2 @FR-6
  Scenario: A sparkline warm-up gap renders as null, never NaN
    Given the recent-bars series for "CAPR" has a missing/warm-up point at index 3
    When the sparkline payload is built and rendered
    Then the missing point is represented as null (a rendered gap), never the value NaN, and the payload round-trips without a serialization error

  @AC-5 @FR-3
  Scenario: Per-condition value chips reuse the traced evaluator's ConditionEval values
    Given the Signal-detail readiness for "CAPR" has a ConditionEval leaf with ref_name "sma_20", lhs_value close, fn ">" and distance_to_threshold +1.4%
    When the readiness leaf renders its live value chip
    Then the chip reads "close > sma_20 +1.4%" using the emitted ConditionEval values, and the value is not recomputed on the client

  @AC-6 @FR-3 @FR-6
  Scenario: A condition leaf with no emitted value renders nothing extra
    Given a readiness leaf for "CAPR" whose ConditionEval carries no lhs_value/distance
    When the leaf renders
    Then no value chip is shown for that leaf (no placeholder, no fabricated number)

  @AC-7 @FR-4
  Scenario: The Signal-detail chart draws target and stop overlay lines with a legend
    Given the opportunity "CAPR" has target_price 14.00 and stop_price 11.50
    When the Signal-detail candlestick chart renders
    Then a horizontal overlay line is drawn at 14.00 labeled "target" and one at 11.50 labeled "stop", and the legend names target, stop, and the signal bar

  @AC-8 @FR-4 @FR-6
  Scenario: An absent target or stop draws no line, not a zero line
    Given the opportunity "CAPR" has no target_price and no stop_price
    When the Signal-detail candlestick chart renders
    Then no target or stop overlay line is drawn, and in particular no line is drawn at price 0

  @AC-9 @FR-5
  Scenario: The order ticket shows risk:reward and a suggested share count computed client-side
    Given the Signal-detail order ticket for "CAPR" with entry 12.34, stop 11.50, target 14.00 and buying power 5000
    When the ticket renders
    Then it shows a risk:reward of "2.0:1" (reward 1.66 vs risk 0.84 per share) and a suggested share count greater than zero sized from buying power and per-share risk, both computed client-side in the UI from those already-available values (no server risk_reward/suggested_qty field)

  @AC-10 @FR-5
  Scenario: The order ticket's execution path is unchanged
    Given the enriched order ticket for "CAPR" in a production (LIVE) environment
    When the trader places the order
    Then the order is submitted through the same usePlaceOrder path with the environment-fixed LIVE mode, identical to pre-feature behavior — the R:R and suggested-size fields are presentation only and are not sent to execution

  @AC-11 @FR-6
  Scenario: An unavailable live quote omits the price field rather than fabricating it
    Given the latest marketdata quote for "CAPR" is unavailable
    When the "CAPR" queue card and the "CAPR" Signal-detail header render
    Then the live price and change% fields are omitted (or em-dashed), never synthesized from a stale or recomputed value

  @AC-12 @FR-7
  Scenario: The live price shown on the Decide surface equals the price on the Signal-detail surface
    Given the marketdata latest trade for "CAPR" is 12.34
    When the "CAPR" Opportunities queue card and the "/insights/market/CAPR" Signal-detail header both render from the same fetch cycle
    Then both surfaces display the same live price "12.34" sourced from the one new marketdata-backed field, and the cross-surface parity test asserts they agree

  @AC-13 @FR-1 @FR-6
  Scenario: A symbol not in the ranked queue keeps the symbol+price-only header
    Given the trader opens "/insights/market/ZZZZ" for a symbol that is not present in the ranked opportunities queue
    When the Signal-detail header renders
    Then it shows only the symbol and its live price, with no per-condition chips, target/stop overlays, or R:R sizing fabricated for it

  @AC-14 @FR-8
  Scenario: Folding in the live quote does not leak look-ahead into ranking
    Given a fixed backtest/ranking input for "CAPR"
    When conviction and readiness ranking are computed with the live-quote enrichment attached and again with it absent
    Then the conviction score and readiness ranking are identical in both cases, proving the live quote does not enter the ranking hot path
