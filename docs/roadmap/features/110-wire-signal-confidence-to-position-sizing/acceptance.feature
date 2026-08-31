Feature: wire-signal-confidence-to-position-sizing
  As a trader viewing a signal's detail page, I want the position-sizing engine to size my
  auto-sized order using that signal's real ExternalSignal.conviction, so a lower-conviction
  signal yields a smaller position and a higher-conviction one a larger position — while the
  plain /trader forms keep their required-qty behavior and the analysis Opportunity.conviction
  ordinal is never used as the probability.

  @AC-1 @FR-1
  Scenario: The real per-signal confidence flows to the signal order ticket
    Given an ExternalSignal for "CAPR" from xstockstrat-ingest with conviction 0.82
    And an Opportunity for "CAPR" whose ordinal conviction is a separate, unrelated value
    When the trader opens the /insights signal-detail page and the SignalOrderTicket renders
    Then the ticket carries 0.82 as the order's real confidence value, read distinctly from the Opportunity ordinal

  @AC-2 @FR-1 @FR-2
  Scenario: Higher confidence auto-sizes a larger position than lower confidence
    Given two ExternalSignals for the same symbol, equity, and ATR — one with conviction 0.9 and one with conviction 0.3
    When the trader submits each from the SignalOrderTicket with the quantity field left blank
    Then the 0.9-confidence order is auto-sized to a strictly larger quantity than the 0.3-confidence order

  @AC-3 @FR-2
  Scenario: A blank quantity on the signal ticket triggers the auto-sizing path
    Given the SignalOrderTicket for "CAPR" with a real confidence of 0.82 attached
    When the trader submits the ticket with the quantity field left blank
    Then the PlaceOrder request is sent with qty <= 0 and confidence 0.82, and the trading service computes the quantity via ComputePositionSize rather than rejecting the order

  @AC-4 @FR-1
  Scenario: The analysis ordinal conviction is not used as the sizing probability
    Given an Opportunity for "CAPR" with ordinal conviction 0.95 and an ExternalSignal for "CAPR" with conviction 0.30
    When the trader submits the SignalOrderTicket for "CAPR" with the quantity field left blank
    Then the confidence sent to PlaceOrder is the ExternalSignal value 0.30, not the ordinal 0.95
    And the Opportunity ordinal's own rendering (strength bars, "N/M conditions") is unchanged

  @AC-5 @FR-3
  Scenario: A plain /trader order form still requires a quantity
    Given the plain /trader order form for "CAPR"
    When the trader submits it with the quantity field left blank
    Then the form is rejected with a "quantity required" validation error and no PlaceOrder request is sent

  @AC-6 @FR-3
  Scenario: The plain /trader/orders form keeps its required-qty behavior unchanged
    Given the /trader/orders order form for "CAPR"
    When the trader submits it with the quantity field left blank
    Then the form is rejected with a "quantity required" validation error, exactly as it behaved before this feature

  @AC-7 @FR-4
  Scenario: An explicit quantity on the signal ticket overrides auto-sizing
    Given the SignalOrderTicket for "CAPR" with a real confidence of 0.82 attached
    When the trader submits the ticket with an explicit quantity of 50
    Then the order is placed for exactly 50 shares, and the confidence value is sent but not consumed by the backend

  @AC-8 @FR-5
  Scenario: The /insights signal ticket is a named PlaceOrder consumer surface
    Given the product spec's Consumer Surface(s) section
    When it is reviewed for C-14 completeness
    Then it names /insights and the SignalOrderTicket as a live PlaceOrder caller, and states the plain /trader segment is explicitly unchanged
