Feature: order-time-in-force-enum (trading)
  Promoted from feature 202 (@AC-1..@AC-4). The trading service accepts only valid,
  broker-supported time-in-force values and maps the TimeInForce enum to the broker wire form,
  rejecting an unspecified or unsupported TIF before broker submission.

  @AC-1 @FR-1 @FR-2 @feature-202
  Scenario: A GTC market order is placed with the TimeInForce enum
    Given an Alpaca account and a Place Order request for 10 shares of "AAPL"
    And the request sets time_in_force to TIME_IN_FORCE_GTC
    When the order is placed
    Then the trading service maps TIME_IN_FORCE_GTC to Alpaca's "gtc" wire value
    And the persisted order returns time_in_force TIME_IN_FORCE_GTC on GetOrder

  @AC-2 @FR-3 @feature-202
  Scenario: An unspecified TIF is rejected at the edge
    Given a Place Order request for 5 shares of "MSFT"
    And the request leaves time_in_force as TIME_IN_FORCE_UNSPECIFIED
    When the order is placed
    Then the trading service returns gRPC InvalidArgument naming the field "time_in_force"
    And no order is forwarded to the broker

  @AC-3 @FR-3 @feature-202
  Scenario: A broker-unsupported TIF is rejected before broker submission
    Given an IBKR account whose adapter does not support TIME_IN_FORCE_OPG
    And a Place Order request for 3 shares of "TSLA" with time_in_force TIME_IN_FORCE_OPG
    When the order is placed
    Then the trading service returns gRPC InvalidArgument naming "TIME_IN_FORCE_OPG" as unsupported for IBKR
    And no order is forwarded to the broker

  @AC-4 @FR-4 @feature-202
  Scenario: A legacy order with an unmappable stored TIF reads back as UNSPECIFIED
    Given a historical order row whose stored time_in_force string is "good_till_cancel"
    When the order is read via GetOrder
    Then the returned time_in_force is TIME_IN_FORCE_UNSPECIFIED
    And the read does not error
