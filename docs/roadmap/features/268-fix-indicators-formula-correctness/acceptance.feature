Feature: fix-indicators-formula-correctness (bug fix)
  Regression guard for docs/reports/2026-10-21-indicators-formula-correctness-defect.md:
  silent empty formula success (D-10), misnamed ATR/VWAP (D-18), and mutation of hidden saga copies (D-54).

  @AC-1 @regression
  Scenario: A formula that exits before producing output is reported as a failure
    Given a formula whose source is "raise SystemExit(0)"
    When ExecuteFormula runs it
    Then success is false
    And the error states that the formula produced no output
    And output is empty

  @AC-2 @regression
  Scenario: A formula whose only output line does not parse is reported as a failure
    Given a formula whose source prints "__OUTPUT__:{" and then raises SystemExit(0)
    When ExecuteFormula runs it
    Then success is false
    And the error states that the formula output could not be parsed

  @AC-3 @regression
  Scenario: A formula that assigns result still succeeds
    Given a formula whose source is "result = {'x': 1}"
    When ExecuteFormula runs it
    Then success is true
    And output is {"x": 1}

  @AC-4 @regression
  Scenario: The ATR built-in matches what it computes
    Given close values [10, 12, 11, 13] and params {"period": 2}
    When ListIndicators and ComputeIndicator "ATR" are called
    Then either ComputeIndicator computes the Average True Range from high, low and previous close supplied with the request
    Or the indicator is no longer described as "Average True Range" and its description names the close-to-close approximation

  @AC-5 @regression
  Scenario: The VWAP built-in matches what it computes
    Given close values [10, 20, 30]
    When ListIndicators and ComputeIndicator "VWAP" are called
    Then either ComputeIndicator weights prices by the volume supplied with the request
    Or the indicator is no longer described as "Volume Weighted Average Price" and its description names the running mean

  @AC-6 @regression
  Scenario: UpdateFormula refuses a pending-hidden saga copy
    Given a formula "f-1" authored by "u-1" with pending_intent_id "i-1"
    When "u-1" calls UpdateFormula on "f-1"
    Then the call fails with NOT_FOUND
    And the stored row for "f-1" is unchanged

  @AC-7 @regression
  Scenario: DeleteFormula refuses a pending-hidden saga copy
    Given a formula "f-1" authored by "u-1" with pending_intent_id "i-1"
    When "u-1" calls DeleteFormula on "f-1"
    Then the call fails with NOT_FOUND
    And "f-1" has no deleted_at timestamp
