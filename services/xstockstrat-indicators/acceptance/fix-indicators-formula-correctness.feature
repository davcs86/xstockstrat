# Promoted from docs/roadmap/features/268-fix-indicators-formula-correctness/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-268` tag.
# Durable business rules xstockstrat-indicators already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-indicators — formula execution reports failures, built-ins are honestly named, saga copies are immutable
  Regression guard for docs/reports/2026-10-21-indicators-formula-correctness-defect.md:
  silent empty formula success (D-10), misnamed ATR/VWAP (D-18), and mutation of hidden saga copies (D-54).

  @AC-1 @FR-1 @regression @feature-268
  Scenario: A formula that exits before producing output is reported as a failure
    Given a formula whose source is "raise SystemExit(0)"
    When ExecuteFormula runs it
    Then success is false
    And error contains "produced no output"
    And output is empty
    And exit_reason is not SANDBOX_EXIT_REASON_SUCCESS

  @AC-2 @FR-1 @regression @feature-268
  Scenario: A formula whose only output line does not parse is reported as a failure
    Given a formula whose source prints "__OUTPUT__:{" and then raises SystemExit(0)
    When ExecuteFormula runs it
    Then success is false
    And error contains "could not be parsed"
    And exit_reason is not SANDBOX_EXIT_REASON_SUCCESS

  @AC-3 @FR-2 @regression @feature-268
  Scenario: A formula that assigns result still succeeds
    Given a formula whose source is "result = {'x': 1}"
    When ExecuteFormula runs it
    Then success is true
    And output is {"x": 1}

  @AC-4 @FR-3 @option-A @regression @feature-268
  Scenario: The ATR built-in is described as the close-to-close approximation it computes
    Given close values [10, 12, 11, 13] and params {"period": 2}
    When ListIndicators and ComputeIndicator "ATR" are called
    Then ListIndicators still lists the key "ATR"
    And its description does not contain "Average True Range"
    And its description names the close-to-close approximation
    And the ComputeIndicator "ATR" response result holds 2 IndicatorPoints with values [1.5, 1.5]
    And the 2 warm-up positions are omitted from result

  @AC-5 @FR-4 @option-A @regression @feature-268
  Scenario: The VWAP built-in is described as the running mean it computes
    Given close values [10, 20, 30]
    When ListIndicators and ComputeIndicator "VWAP" are called
    Then ListIndicators still lists the key "VWAP"
    And its description does not contain "Volume Weighted Average Price"
    And its description names the running mean
    And the ComputeIndicator "VWAP" response result holds IndicatorPoints with values [10, 15, 20]

  @AC-6 @FR-5 @regression @feature-268
  Scenario: UpdateFormula refuses a pending-hidden saga copy
    Given a formula "f-1" authored by "u-1" with pending_intent_id "i-1"
    When "u-1" calls UpdateFormula on "f-1"
    Then the call fails with NOT_FOUND
    And the stored row for "f-1" is unchanged

  @AC-7 @FR-5 @regression @feature-268
  Scenario: DeleteFormula refuses a pending-hidden saga copy
    Given a formula "f-1" authored by "u-1" with pending_intent_id "i-1"
    When "u-1" calls DeleteFormula on "f-1"
    Then the call fails with NOT_FOUND
    And "f-1" has no deleted_at timestamp
