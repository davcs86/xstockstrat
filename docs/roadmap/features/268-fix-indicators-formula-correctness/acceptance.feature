Feature: fix-indicators-formula-correctness (bug fix)
  Regression guard for docs/reports/2026-10-21-indicators-formula-correctness-defect.md:
  silent empty formula success (D-10), misnamed ATR/VWAP (D-18), and mutation of hidden saga copies (D-54).
  D-18 has two allowed fix paths (product-spec OQ-1). @option-A scenarios (AC-4, AC-5) and @option-B
  scenarios (AC-8, AC-9) exclude each other. Design keeps one pair and deletes the other.

  @AC-1 @FR-1 @regression
  Scenario: A formula that exits before producing output is reported as a failure
    Given a formula whose source is "raise SystemExit(0)"
    When ExecuteFormula runs it
    Then success is false
    And error contains "produced no output"
    And output is empty
    And exit_reason is not SANDBOX_EXIT_REASON_SUCCESS

  @AC-2 @FR-1 @regression
  Scenario: A formula whose only output line does not parse is reported as a failure
    Given a formula whose source prints "__OUTPUT__:{" and then raises SystemExit(0)
    When ExecuteFormula runs it
    Then success is false
    And error contains "could not be parsed"
    And exit_reason is not SANDBOX_EXIT_REASON_SUCCESS

  @AC-3 @FR-2 @regression
  Scenario: A formula that assigns result still succeeds
    Given a formula whose source is "result = {'x': 1}"
    When ExecuteFormula runs it
    Then success is true
    And output is {"x": 1}

  @AC-4 @FR-3 @option-A @regression
  Scenario: The ATR built-in is described as the close-to-close approximation it computes
    Given close values [10, 12, 11, 13] and params {"period": 2}
    When ListIndicators and ComputeIndicator "ATR" are called
    Then ListIndicators still lists the key "ATR"
    And its description does not contain "Average True Range"
    And its description names the close-to-close approximation
    And the ComputeIndicator "ATR" response result holds 2 IndicatorPoints with values [1.5, 1.5]
    And the 2 warm-up positions are omitted from result

  @AC-5 @FR-4 @option-A @regression
  Scenario: The VWAP built-in is described as the running mean it computes
    Given close values [10, 20, 30]
    When ListIndicators and ComputeIndicator "VWAP" are called
    Then ListIndicators still lists the key "VWAP"
    And its description does not contain "Volume Weighted Average Price"
    And its description names the running mean
    And the ComputeIndicator "VWAP" response result holds IndicatorPoints with values [10, 15, 20]

  @AC-6 @FR-5 @regression
  Scenario: UpdateFormula refuses a pending-hidden saga copy
    Given a formula "f-1" authored by "u-1" with pending_intent_id "i-1"
    When "u-1" calls UpdateFormula on "f-1"
    Then the call fails with NOT_FOUND
    And the stored row for "f-1" is unchanged

  @AC-7 @FR-5 @regression
  Scenario: DeleteFormula refuses a pending-hidden saga copy
    Given a formula "f-1" authored by "u-1" with pending_intent_id "i-1"
    When "u-1" calls DeleteFormula on "f-1"
    Then the call fails with NOT_FOUND
    And "f-1" has no deleted_at timestamp

  @AC-8 @FR-3 @option-B @regression
  Scenario: The ATR built-in computes the Average True Range from high, low and close
    Given high values [11, 13, 12, 14], low values [9, 11, 10, 12], close values [10, 12, 11, 13] and params {"period": 2}
    When ComputeIndicator "ATR" is called with those series
    Then the last IndicatorPoint in the response result has value 2.5, the simple mean of true ranges 2 and 3 over the last 2 bars
    And ListIndicators still describes "ATR" as "Average True Range"

  @AC-9 @FR-4 @option-B @regression
  Scenario: The VWAP built-in weights prices by volume
    Given close values [10, 20, 30] and volume values [1, 1, 2]
    When ComputeIndicator "VWAP" is called with those series
    Then the response result holds IndicatorPoints with values [10, 15, 22.5]
    And ListIndicators still describes "VWAP" as "Volume Weighted Average Price"
