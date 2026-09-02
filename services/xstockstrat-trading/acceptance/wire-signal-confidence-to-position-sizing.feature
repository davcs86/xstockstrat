# Durable business-rule suite for xstockstrat-trading.
# Populated by scenario PROMOTION (Constitution C-16). Source-feature provenance on each @feature-N tag.

Feature: wire-signal-confidence-to-position-sizing (xstockstrat-trading guarantees)
  Confidence-scaled auto-sizing behavior in the trading service's position-sizing path.

  @AC-2 @FR-1 @FR-2 @feature-110
  Scenario: Higher confidence auto-sizes a larger position than lower confidence
    Given two symbols with the same equity and ATR — one whose ExternalSignal conviction is 0.9 and one whose ExternalSignal conviction is 0.3
    When the trader submits each from the symbol-page OrderForm ticket with the quantity field left blank
    Then the 0.9-confidence order is auto-sized to a strictly larger quantity than the 0.3-confidence order
