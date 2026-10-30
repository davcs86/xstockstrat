# Promoted from docs/roadmap/features/251-fix-getpnl-source-service/acceptance.feature on launch (C-16). Scenarios are verbatim; each carries its source @AC-* and a @feature-251 tag. A rule enters only by promotion.
Feature: xstockstrat-trading - fill events carry side, canonical source_service and fees

  @AC-10 @FR-1 @FR-2 @regression @feature-251
  Scenario Outline: Trading's fill events carry the order side, the canonical source_service and the fee
    Given a SELL order "ord-1" for 10 AAPL on an ALPACA account
    And the broker reports the order <broker_status>
    When the CancelOrder not-cancelable path adopts the broker status
    Then the ledger receives one "<event_type>" event with source_service "xstockstrat-trading" and stream_key "ord-1"
    And its payload carries side "ORDER_SIDE_SELL", the unsigned "<qty_key>" and the "fees" key
