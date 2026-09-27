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

  @AC-6 @FR-6 @FR-7
  Scenario: A backtest applies the per-sector override valid as-of each bar
    Given a strategy sets RSI oversold default 30 and override 25 for "TECHNOLOGY"
    And "XYZ" was "TECHNOLOGY" for every bar in the backtest window
    When the strategy is backtested over "XYZ"
    Then every bar is scored with an RSI oversold threshold of 25

  @AC-7 @FR-7
  Scenario: A mid-series reclassification does not leak the later sector backward (no look-ahead)
    Given a strategy sets RSI oversold override 25 for "TECHNOLOGY" and 20 for "COMMUNICATION_SERVICES"
    And "XYZ" was "TECHNOLOGY" through 2018-09-30 then "COMMUNICATION_SERVICES" from 2018-10-01
    When the strategy is backtested over "XYZ" across 2018-08-01 to 2018-11-30
    Then bars on or before 2018-09-30 are scored with threshold 25
    And bars from 2018-10-01 onward are scored with threshold 20

  @AC-8 @FR-8
  Scenario: An unclassified symbol falls back to the default bucket without failing
    Given a strategy sets RSI oversold default 30 and override 25 for "TECHNOLOGY"
    And symbol "NEWCO" has no classification row for any bar in the window
    When the strategy is backtested over "NEWCO"
    Then every bar is scored with an RSI oversold threshold of 30
    And the backtest completes without error

  @AC-9 @FR-9
  Scenario: The Sector enum carries an unspecified sentinel
    Given the generated Sector proto enum
    When its zero value is inspected
    Then the zero value is SECTOR_UNSPECIFIED
