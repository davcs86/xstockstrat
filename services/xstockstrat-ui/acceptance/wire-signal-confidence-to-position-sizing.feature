# Durable business-rule suite for xstockstrat-ui.
# Populated by scenario PROMOTION (Constitution C-16). Source-feature provenance on each @feature-N tag.

Feature: wire-signal-confidence-to-position-sizing (xstockstrat-ui guarantees)
  Symbol-page OrderForm confidence affordance and the plain /trader entry forms' required-qty behavior.

  @AC-1 @FR-1 @feature-110
  Scenario: The real per-signal confidence flows to the symbol-page order ticket
    Given an ExternalSignal for "CAPR" from xstockstrat-ingest with conviction 0.82
    And an Opportunity for "CAPR" whose ordinal conviction is a separate, unrelated value
    When the trader opens the /trader/positions/CAPR symbol page and its OrderForm ticket renders
    Then the ticket carries 0.82 as the order's real signal confidence value, read distinctly from the Opportunity ordinal

  @AC-4 @FR-1 @feature-110
  Scenario: The analysis ordinal conviction is not used as the sizing probability
    Given an Opportunity for "CAPR" with ordinal conviction 0.95 and an ExternalSignal for "CAPR" with conviction 0.30
    When the trader submits the /trader/positions/CAPR OrderForm ticket with the quantity field left blank
    Then the confidence sent to PlaceOrder is the ExternalSignal value 0.30, not the ordinal 0.95
    And the Opportunity ordinal's own rendering (strength bars, "N/M conditions") is unchanged

  @AC-5 @FR-3 @feature-110
  Scenario: A plain /trader order form still requires a quantity
    Given the plain /trader order form for "CAPR" (OrderForm mounted with no signalConfidence prop)
    When the trader submits it with the quantity field left blank
    Then the form is rejected with a "quantity required" validation error and no PlaceOrder request is sent

  @AC-6 @FR-3 @feature-110
  Scenario: The plain /trader/orders form keeps its required-qty behavior unchanged
    Given the /trader/orders order form for "CAPR" (OrderForm mounted with no signalConfidence prop)
    When the trader submits it with the quantity field left blank
    Then the form is rejected with a "quantity required" validation error, exactly as it behaved before this feature

  @AC-7 @FR-4 @feature-110
  Scenario: An explicit quantity on the symbol-page ticket overrides auto-sizing
    Given the /trader/positions/CAPR OrderForm ticket with a real signal confidence of 0.82 attached
    When the trader submits the ticket with an explicit quantity of 50
    Then the order is placed for exactly 50 shares, and the confidence value is sent but not consumed by the backend

  @AC-9 @FR-6 @feature-110
  Scenario: The orphaned signal-order-ticket component and its route stub are removed
    Given feature 125 superseded the old SignalOrderTicket ticket with the unified symbol page's OrderForm
    When this feature's change is applied
    Then services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx no longer exists
    And no page or component imports SignalOrderTicket
    And the redirect-only route services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx no longer exists
    And the e2e specs that navigated to /insights/market/[symbol] are updated so the suite stays green
