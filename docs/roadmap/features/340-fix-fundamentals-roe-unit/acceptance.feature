Feature: fix-fundamentals-roe-unit (bug fix)
  Regression guard for docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md.
  The producing path is not traced yet (product-spec Open Question 1): design pins the Given of
  @AC-1 and @AC-5 to the traced path and its native input unit; the Then values are binding.

  # guards: docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md
  @AC-1 @FR-1 @FR-2 @regression
  Scenario: LYFT's served ROE agrees with its own net income and equity
    Given the fundamentals path that produced roe 3.6634 for "LYFT" on staging
    And that path's inputs for "LYFT" amount to net income 28070000 over shareholders' equity 767000000
    When GetFundamentals is called for "LYFT"
    Then the returned roe is 0.0366

  @AC-2 @FR-1
  Scenario Outline: every provider path serves ROE as a fraction
    Given the <provider> path supplies fundamentals for "LYFT" with <raw input>
    When GetFundamentals is called for "LYFT"
    Then the returned roe is 0.0366
    And GetFundamentalsMulti for "LYFT" returns the same roe

    Examples:
      | provider | raw input                                              |
      | Finnhub  | roeTTM 3.66 expressed in percentage points             |
      | FMP      | returnOnEquityTTM 0.0366 expressed as a fraction       |
      | EDGAR    | net income 28070000 and shareholders' equity 767000000 |

  @AC-3 @FR-3
  Scenario: historical fundamentals serve ROE as a fraction
    Given the stored annual period "FY2025" for "LYFT" has net income 28070000 and shareholders' equity 767000000
    When GetHistoricalFundamentals is called for "LYFT"
    Then the "FY2025" period's roe is 0.0366

  @AC-4 @FR-4
  Scenario Outline: an absent or negative ROE is preserved
    Given a fundamentals provider that reports <provider roe> for "LYFT"
    When GetFundamentals is called for "LYFT"
    Then the returned roe is <roe>

    Examples:
      | provider roe                                              | roe   |
      | no ROE value                                              | 0     |
      | net income -191750000 over shareholders' equity 767000000 | -0.25 |

  # guards: docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md
  @AC-5 @FR-5 @regression
  Scenario: a wrong ROE stored before the fix is no longer served
    Given roe 3.6634 was stored for "LYFT" before the fix
    And the inputs for "LYFT" amount to net income 28070000 over shareholders' equity 767000000
    When the fix is deployed and GetFundamentals is called for "LYFT"
    Then the returned roe is 0.0366
