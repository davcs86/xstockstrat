Feature: order-time-in-force-enum (ui)
  Promoted from feature 202 (@AC-5). The /trader Place Order form emits the selected time-in-force
  as a Connect-JSON NAME-string, and the UI build enforces an exhaustive TimeInForce label map.

  @AC-5 @FR-5 @feature-202
  Scenario: The trader form sends the TIF as a Connect-JSON NAME-string
    Given the /trader Place Order form with time-in-force "GTC" selected
    When the form submits the order over Connect-JSON
    Then the request body carries time_in_force as the string "TIME_IN_FORCE_GTC"
    And the UI build type-checks the exhaustive TimeInForce label map with no missing key
