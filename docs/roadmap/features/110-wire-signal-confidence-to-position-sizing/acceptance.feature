Feature: wire-signal-confidence-to-position-sizing
  As a trader viewing a symbol's detail page, I want the position-sizing engine to size my
  auto-sized order using that symbol's real ExternalSignal.conviction, so a lower-conviction
  signal yields a smaller position and a higher-conviction one a larger position — while the
  plain /trader entry forms keep their required-qty behavior and the analysis Opportunity.conviction
  ordinal is never used as the probability.

  # The live order ticket is `OrderForm` on the unified symbol page
  # (services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:342, feature 125). The
  # affordance is enabled by a scoped `signalConfidence` prop; the plain /trader entry forms mount
  # the same component without the prop. The old `SignalOrderTicket.tsx` (feature 083) is orphaned
  # dead code superseded by feature 125 and is deleted in-scope (FR-6).

  @AC-1 @FR-1
  Scenario: The real per-signal confidence flows to the symbol-page order ticket
    Given an ExternalSignal for "CAPR" from xstockstrat-ingest with conviction 0.82
    And an Opportunity for "CAPR" whose ordinal conviction is a separate, unrelated value
    When the trader opens the /trader/positions/CAPR symbol page and its OrderForm ticket renders
    Then the ticket carries 0.82 as the order's real signal confidence value, read distinctly from the Opportunity ordinal

  @AC-2 @FR-1 @FR-2
  Scenario: Higher confidence auto-sizes a larger position than lower confidence
    Given two symbols with the same equity and ATR — one whose ExternalSignal conviction is 0.9 and one whose ExternalSignal conviction is 0.3
    When the trader submits each from the symbol-page OrderForm ticket with the quantity field left blank
    Then the 0.9-confidence order is auto-sized to a strictly larger quantity than the 0.3-confidence order

  @AC-3 @FR-2
  Scenario: A blank quantity on the symbol-page ticket triggers the auto-sizing path
    Given the /trader/positions/CAPR OrderForm ticket with a real signal confidence of 0.82 attached via the signalConfidence prop
    When the trader submits the ticket with the quantity field left blank
    Then the blank quantity is coerced to 0 (never NaN) and the PlaceOrder request is sent with qty <= 0 and confidence 0.82, and the trading service computes the quantity via ComputePositionSize rather than rejecting the order

  @AC-4 @FR-1
  Scenario: The analysis ordinal conviction is not used as the sizing probability
    Given an Opportunity for "CAPR" with ordinal conviction 0.95 and an ExternalSignal for "CAPR" with conviction 0.30
    When the trader submits the /trader/positions/CAPR OrderForm ticket with the quantity field left blank
    Then the confidence sent to PlaceOrder is the ExternalSignal value 0.30, not the ordinal 0.95
    And the Opportunity ordinal's own rendering (strength bars, "N/M conditions") is unchanged

  @AC-5 @FR-3
  Scenario: A plain /trader order form still requires a quantity
    Given the plain /trader order form for "CAPR" (OrderForm mounted with no signalConfidence prop)
    When the trader submits it with the quantity field left blank
    Then the form is rejected with a "quantity required" validation error and no PlaceOrder request is sent

  @AC-6 @FR-3
  Scenario: The plain /trader/orders form keeps its required-qty behavior unchanged
    Given the /trader/orders order form for "CAPR" (OrderForm mounted with no signalConfidence prop)
    When the trader submits it with the quantity field left blank
    Then the form is rejected with a "quantity required" validation error, exactly as it behaved before this feature

  @AC-7 @FR-4
  Scenario: An explicit quantity on the symbol-page ticket overrides auto-sizing
    Given the /trader/positions/CAPR OrderForm ticket with a real signal confidence of 0.82 attached
    When the trader submits the ticket with an explicit quantity of 50
    Then the order is placed for exactly 50 shares, and the confidence value is sent but not consumed by the backend

  @AC-8 @FR-5
  Scenario: The symbol-page OrderForm reaches PlaceOrder while the plain /trader form's blank-qty path does not auto-size
    Given the /trader/positions/CAPR OrderForm ticket with a real signal confidence attached and the quantity field left blank
    And the plain /trader order form for "CAPR" (no signalConfidence prop) with the quantity field left blank
    When each is submitted
    Then the symbol-page OrderForm sends a PlaceOrder request that routes into 023's auto-sizing path (qty <= 0 with the real confidence)
    And the plain /trader form sends no PlaceOrder request and is rejected with a "quantity required" validation error, so it never auto-sizes

  @AC-9 @FR-6
  Scenario: The orphaned signal-order-ticket component and its route stub are removed
    Given feature 125 superseded the old SignalOrderTicket ticket with the unified symbol page's OrderForm
    When this feature's change is applied
    Then services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx no longer exists
    And no page or component imports SignalOrderTicket
    And the redirect-only route services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx no longer exists
    And the e2e specs that navigated to /insights/market/[symbol] are updated so the suite stays green
