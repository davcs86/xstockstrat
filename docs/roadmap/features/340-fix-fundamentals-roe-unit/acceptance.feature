Feature: fix-fundamentals-roe-unit (bug fix)
  Regression guard for docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md.

  @AC-1 @regression
  Scenario: ROE is served as a fraction on every provider path
    Given a fundamentals provider that reports a trailing ROE of 3.66 percent for "LYFT"
    When GetFundamentals is called for "LYFT"
    Then the returned roe is 0.0366
