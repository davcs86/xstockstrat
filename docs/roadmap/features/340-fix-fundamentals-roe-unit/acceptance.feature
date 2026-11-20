Feature: fix-fundamentals-roe-unit (bug fix)
  The traced path is the EDGAR quarterly TTM derivation served through the EDGAR snapshot. The values
  come from LYFT's SEC companyfacts (CIK0001759509), fixture
  services/xstockstrat-marketdata/internal/edgar/testdata/lyft_companyfacts.json.

  # guards: docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md
  @AC-1 @FR-1 @FR-2 @regression
  Scenario: LYFT's served ROE agrees with its own net income and equity
    Given the EDGAR snapshot path serves fundamentals for "LYFT" from its SEC companyfacts filing
    And the filing's trailing-twelve-month net income is 2809866000 and its "Q3-2026" quarter-end shareholders' equity is 2980873000
    When GetFundamentals is called for "LYFT"
    Then the returned roe is 0.942632

  @AC-2 @FR-1
  Scenario Outline: each vendor provider path serves ROE as a fraction (unit-level guard)
    Given the <provider> path supplies fundamentals for "LYFT" with <raw input>
    When GetFundamentals is called for "LYFT"
    Then the returned roe is 0.0366
    And GetFundamentalsMulti for "LYFT" returns the same roe

    Examples:
      | provider | raw input                                        |
      | Finnhub  | roeTTM 3.66 expressed in percentage points       |
      | FMP      | returnOnEquityTTM 0.0366 expressed as a fraction |

  @AC-3 @FR-3
  Scenario: historical fundamentals serve ROE as a fraction
    Given the stored annual period "FY2025" for "LYFT" has net income 2844008000 and shareholders' equity 3273523000
    When GetHistoricalFundamentals is called for "LYFT"
    Then the "FY2025" period's roe is 0.868791

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
    Given roe 3.6634 was stored for "LYFT" period "Q3-2026" before the fix
    And the filing's trailing-twelve-month net income is 2809866000 over "Q3-2026" quarter-end shareholders' equity 2980873000
    And the post-deploy fundamentals backfill has re-derived the stored "LYFT" periods
    When the fix is deployed and GetFundamentals is called for "LYFT"
    Then the returned roe is 0.942632
