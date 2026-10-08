Feature: sector-classification-strategy-params
  As a strategy author, I want to define per-sector formula parameter overrides within a single
  strategy, so that the same strategy applies sector-appropriate thresholds and lookbacks and
  backtests score each symbol with the sector it belonged to at the time of each bar.

  @AC-1 @FR-1
  Scenario: FMP gateway never exceeds the configured rate limit under concurrency
    Given marketdata.fmp.rate_limit_rps is set to 5
    And 50 classification-refresh requests are issued to the centralized FMP gateway at once
    When the gateway dispatches the outbound FMP calls
    Then no more than 5 outbound FMP requests are made in any rolling 1-second window

  @AC-2 @FR-2 @FR-3
  Scenario: A sector change writes a new version and closes the prior one
    Given symbol "XYZ" has one open classification row with sector "TECHNOLOGY" and valid_to NULL
    When the refresh job observes FMP now reports "XYZ" as "COMMUNICATION_SERVICES"
    Then the prior row's valid_to is set to the refresh timestamp
    And a new row is inserted with sector "COMMUNICATION_SERVICES" and valid_to NULL
    And exactly one open row exists for "XYZ"

  @AC-3 @FR-3
  Scenario: An unchanged sector performs no write
    Given symbol "XYZ" has one open classification row with sector "TECHNOLOGY"
    When the refresh job observes FMP still reports "XYZ" as "TECHNOLOGY"
    Then no row is inserted or updated for "XYZ"
    And the open row's valid_from is unchanged

  @AC-4 @FR-4
  Scenario: An FMP outage does not break classification reads
    Given the FMP API returns HTTP 503 for every request during a refresh cycle
    And symbol "XYZ" has an existing open classification row with sector "ENERGY"
    When a caller reads the current sector for "XYZ"
    Then the read returns "ENERGY" from the local store
    And the read does not error

  @AC-5 @FR-5
  Scenario: As-of lookup returns the sector valid at a historical timestamp
    Given "XYZ" was "TECHNOLOGY" from 2018-01-01 to 2018-09-30 and "COMMUNICATION_SERVICES" from 2018-10-01 onward
    When the as-of classification is requested for "XYZ" at 2018-06-15
    Then the returned sector is "TECHNOLOGY"

  # C-15 amendment (2026-10-06, operator-approved): @AC-6/7/8/10/13 originally phrased the override
  # as an "RSI oversold threshold" — a rule rhs literal. Overrides are component PARAMS only
  # (field 15 design), so these scenarios now use the RSI component's "period" param.
  @AC-6 @FR-6 @FR-7
  Scenario: A backtest applies the per-sector override valid as-of each bar
    Given a strategy sets the RSI component param "period" default 14 and override 10 for "TECHNOLOGY"
    And "XYZ" was "TECHNOLOGY" for every bar in the backtest window
    When the strategy is backtested over "XYZ"
    Then every bar is scored with RSI period 10

  @AC-7 @FR-7
  Scenario: A mid-series reclassification does not leak the later sector backward (no look-ahead)
    Given a strategy sets the RSI component param "period" override 10 for "TECHNOLOGY" and 7 for "COMMUNICATION_SERVICES"
    And "XYZ" was "TECHNOLOGY" through 2018-09-30 then "COMMUNICATION_SERVICES" from 2018-10-01
    When the strategy is backtested over "XYZ" across 2018-08-01 to 2018-11-30
    Then bars on or before 2018-09-30 are scored with RSI period 10
    And bars from 2018-10-01 onward are scored with RSI period 7

  @AC-8 @FR-8
  Scenario: An unclassified symbol falls back to the default bucket without failing
    Given a strategy sets the RSI component param "period" default 14 and override 10 for "TECHNOLOGY"
    And symbol "NEWCO" has no classification row for any bar in the window
    When the strategy is backtested over "NEWCO"
    Then every bar is scored with RSI period 14
    And the backtest completes without error

  @AC-9 @FR-9
  Scenario: The Sector enum carries an unspecified sentinel
    Given the generated Sector proto enum
    When its zero value is inspected
    Then the zero value is SECTOR_UNSPECIFIED

  @AC-10 @FR-10
  Scenario: A pre-go-live bar for a seeded symbol resolves to the epoch-seeded sector, not the default
    Given "XYZ" has one open classification row with sector "TECHNOLOGY" and valid_from 1900-01-01T00:00:00Z
    And a strategy sets the RSI component param "period" default 14 and override 10 for "TECHNOLOGY"
    When the strategy is backtested over "XYZ" across 2015-01-01 to 2015-12-31
    Then every bar is scored with RSI period 10

  @AC-11 @FR-10 @FR-2
  Scenario: The first post-go-live reclassification closes the epoch-seeded row without rewriting pre-go-live history
    Given "XYZ" has one open classification row with sector "TECHNOLOGY" and valid_from 1900-01-01T00:00:00Z
    When the refresh job observes FMP now reports "XYZ" as "ENERGY" at 2026-10-01T00:00:00Z
    Then the epoch-seeded row's valid_to is set to 2026-10-01T00:00:00Z
    And a new open row is inserted with sector "ENERGY" and valid_from 2026-10-01T00:00:00Z
    And an as-of lookup for "XYZ" at 2015-06-15 returns "TECHNOLOGY"
    And an as-of lookup for "XYZ" at 2026-10-02 returns "ENERGY"

  @AC-12 @FR-2
  Scenario: Concurrent first-observation of a symbol yields exactly one open row seeded at the epoch
    Given "NEWCO" has no classification row
    When two refresh workers observe FMP reports "NEWCO" as "HEALTH_CARE" at the same instant
    Then exactly one open classification row exists for "NEWCO"
    And its valid_from is 1900-01-01T00:00:00Z
    And its valid_to is NULL

  @AC-13 @FR-10 @FR-8
  Scenario: In one backtest a seeded symbol uses its epoch sector while an unseeded symbol falls back to default
    Given a strategy sets the RSI component param "period" default 14 and override 10 for "TECHNOLOGY"
    And "XYZ" has one open classification row with sector "TECHNOLOGY" and valid_from 1900-01-01T00:00:00Z
    And "NEWCO" has no classification row for any bar in the window
    When the strategy is backtested over "XYZ" and "NEWCO" across 2015-01-01 to 2015-12-31
    Then every "XYZ" bar is scored with RSI period 10
    And every "NEWCO" bar is scored with RSI period 14

  @AC-14 @FR-6 @FR-7
  Scenario: Per-sector overrides reach a fundamentals-input custom formula's params
    Given strategy "fundamentals_macd_blend" has a component "fscore" bound to the custom formula "Fundamentals Value+Quality Composite (v1)" (declared fundamentalInputs)
    And the strategy declares an override for "fscore" param "de_bad" with default 2.0 and sector "FINANCIALS" = 12.0
    And "AXP" has one open classification row with sector "FINANCIALS"
    And an AXP point-in-time EDGAR period with debt_to_equity 8.8 is the as-of filing for a bar
    When the strategy is backtested over "AXP" covering that bar
    Then that bar's fscore is computed with de_bad = 12.0, not 2.0
    And the same override applies on the live-snapshot surfaces (readiness, opportunities, live loop)
