# Promoted from docs/roadmap/features/217-sector-classification-strategy-params/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-217` tag.
# C-15 amendment (2026-10-06, operator-approved): overrides are component PARAMS only, so these
# scenarios use the RSI component's "period" param.

Feature: xstockstrat-analysis — per-sector strategy param overrides applied point-in-time
  A strategy's per-sector component-param overrides are resolved from the sector valid as-of each
  bar, never a later one, with a default bucket for unclassified symbols.

  @feature-217 @AC-6 @FR-6 @FR-7
  Scenario: A backtest applies the per-sector override valid as-of each bar
    Given a strategy sets the RSI component param "period" default 14 and override 10 for "TECHNOLOGY"
    And "XYZ" was "TECHNOLOGY" for every bar in the backtest window
    When the strategy is backtested over "XYZ"
    Then every bar is scored with RSI period 10

  @feature-217 @AC-7 @FR-7
  Scenario: A mid-series reclassification does not leak the later sector backward (no look-ahead)
    Given a strategy sets the RSI component param "period" override 10 for "TECHNOLOGY" and 7 for "COMMUNICATION_SERVICES"
    And "XYZ" was "TECHNOLOGY" through 2018-09-30 then "COMMUNICATION_SERVICES" from 2018-10-01
    When the strategy is backtested over "XYZ" across 2018-08-01 to 2018-11-30
    Then bars on or before 2018-09-30 are scored with RSI period 10
    And bars from 2018-10-01 onward are scored with RSI period 7

  @feature-217 @AC-8 @FR-8
  Scenario: An unclassified symbol falls back to the default bucket without failing
    Given a strategy sets the RSI component param "period" default 14 and override 10 for "TECHNOLOGY"
    And symbol "NEWCO" has no classification row for any bar in the window
    When the strategy is backtested over "NEWCO"
    Then every bar is scored with RSI period 14
    And the backtest completes without error

  @feature-217 @AC-10 @FR-10
  Scenario: A pre-go-live bar for a seeded symbol resolves to the epoch-seeded sector, not the default
    Given "XYZ" has one open classification row with sector "TECHNOLOGY" and valid_from 1900-01-01T00:00:00Z
    And a strategy sets the RSI component param "period" default 14 and override 10 for "TECHNOLOGY"
    When the strategy is backtested over "XYZ" across 2015-01-01 to 2015-12-31
    Then every bar is scored with RSI period 10

  @feature-217 @AC-13 @FR-10 @FR-8
  Scenario: In one backtest a seeded symbol uses its epoch sector while an unseeded symbol falls back to default
    Given a strategy sets the RSI component param "period" default 14 and override 10 for "TECHNOLOGY"
    And "XYZ" has one open classification row with sector "TECHNOLOGY" and valid_from 1900-01-01T00:00:00Z
    And "NEWCO" has no classification row for any bar in the window
    When the strategy is backtested over "XYZ" and "NEWCO" across 2015-01-01 to 2015-12-31
    Then every "XYZ" bar is scored with RSI period 10
    And every "NEWCO" bar is scored with RSI period 14

  @feature-217 @AC-14 @FR-6 @FR-7
  Scenario: Per-sector overrides reach a fundamentals-input custom formula's params
    Given strategy "fundamentals_macd_blend" has a component "fscore" bound to the custom formula "Fundamentals Value+Quality Composite (v1)" (declared fundamentalInputs)
    And the strategy declares an override for "fscore" param "de_bad" with default 2.0 and sector "FINANCIALS" = 12.0
    And "AXP" has one open classification row with sector "FINANCIALS"
    And an AXP point-in-time EDGAR period with debt_to_equity 8.8 is the as-of filing for a bar
    When the strategy is backtested over "AXP" covering that bar
    Then that bar's fscore is computed with de_bad = 12.0, not 2.0
    And the same override applies on the live-snapshot surfaces (readiness, opportunities, live loop)
