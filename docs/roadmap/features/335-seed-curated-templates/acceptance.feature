Feature: seed-curated-templates
  As a platform admin, I want the curated staging formulas, signal sources and non-junk strategies
  seeded as templates by migration, so that every environment has a starting catalog users copy with
  instantiate_template.

  @AC-1 @FR-1
  Scenario: Formula catalog is seeded with the 9 curated formulas
    Given a database with all indicators migrations applied and no admin-authored templates
    When "bob" calls ListTemplates on indicators
    Then the response contains exactly 9 templates at version 1
    And their names are "Volatility Trailing Stop Direction", "Bollinger Squeeze Percentile", "Fundamentals Value+Quality Composite (v1)", "SMA Trend Slope (fractional)", "Momentum Quality (Clenow)", "Kaufman Efficiency Ratio", "Mean-Reversion Z-Score", "rolling_zscore_v2" and "kaufman_efficiency_ratio_v2"

  @AC-2 @FR-1
  Scenario: A seeded formula template instantiates into an executable private formula
    Given the seeded template named "Volatility Trailing Stop Direction"
    When "bob" instantiates it and runs the copy over 60 daily closes with period 22 and multiplier 3.0
    Then "bob" owns a new formula with parameters "period" (default 22) and "multiplier" (default 3.0)
    And the run returns series "value" and "stop_line" of length 60

  @AC-3 @FR-2
  Scenario: Strategy catalog is seeded with the non-junk strategies only
    Given a database with all analysis migrations applied and no admin-authored templates
    When "bob" calls ListTemplates on analysis
    Then the response contains exactly 14 templates, including "dip_buyer_vol_stop", "squeeze_breakout_trend", "fundamentals_macd_blend" and "range_mean_reversion_v2"
    And it contains no template for "zz_fscore_probe", "dbg_regime_voo_inverted", "diag_formula_probe", "jjjjjjj", "bbbb", "aaaa", "rsi20", "range_mean_reversion" or "range_mean_reversion_v3"

  @AC-4 @FR-3
  Scenario: Every seeded strategy template resolves its formula references inside the seeded catalog
    Given the seeded strategy templates and the seeded formula templates
    When each strategy template's COMPONENT_KIND_CUSTOM_FORMULA components are inspected
    Then every formula_id equals the template_id of a seeded, non-retired formula template

  @AC-5 @FR-3 @FR-4
  Scenario: Instantiating a seeded strategy deep-copies its formulas and stays non-live
    Given the seeded strategy template for "squeeze_breakout_trend"
    When "bob" instantiates it
    Then "bob" owns a new strategy with active false and live_enabled false
    And "bob" owns 2 new private formulas copied from the "Bollinger Squeeze Percentile" and "Volatility Trailing Stop Direction" templates
    And the strategy's "sqz" and "vts" components point to "bob"'s copies

  @AC-6 @FR-5
  Scenario: Source catalog is seeded with the 4 mediated staging sources
    Given a database with all ingest migrations applied and no admin-authored templates
    When "bob" calls ListTemplates on ingest
    Then the response contains exactly 4 templates whose payload slugs are "sec_edgar_8k", "sec_edgar_form4", "prnewswire_releases" and "robinhood_snacks"
    And the "sec_edgar_form4" payload has source_type "mediated_simple_website" and config_json.scrape_selector "entry"

  @AC-7 @FR-5
  Scenario: A seeded website source template instantiates into a private source
    Given the seeded source template for "prnewswire_releases"
    When "bob" instantiates it with slug "bob_prnewswire"
    Then "bob" owns an active source "bob_prnewswire" with config_json.url "https://www.prnewswire.com/news-releases/news-releases-list/" and reliability_weight 1.0

  @AC-8 @FR-6
  Scenario: Replaying a seed migration does not duplicate or overwrite templates
    Given the indicators seed migration has been applied and an admin has since updated one seeded template to version 2
    When the seed migration's up SQL is executed a second time
    Then indicators.formula_templates still holds 9 rows
    And the admin-updated template is still at version 2 with the admin's payload

  @AC-9 @FR-6
  Scenario: The down migration removes only seeded rows
    Given the seeded catalog plus an admin-authored formula template "tpl-admin-custom"
    When the indicators seed migration's down SQL is executed
    Then indicators.formula_templates holds exactly 1 row with template_id "tpl-admin-custom"

  @AC-16 @FR-6
  Scenario Outline: Every seed migration replays without duplicating or overwriting
    Given the <service> seed migration has been applied and an admin has since retired one seeded template
    When the <service> seed migration's up SQL is executed a second time
    Then <table> still holds <count> rows
    And the retired template still has a non-null retired_at

    Examples:
      | service  | table                       | count |
      | analysis | analysis.strategy_templates | 14    |
      | ingest   | ingest.source_templates     | 4     |

  @AC-17 @FR-6
  Scenario: A down migration keeps a seeded template an admin has edited
    Given the seeded strategy catalog in which an admin updated "tpl-quality_dip_buyer" to version 2
    When the analysis seed migration's down SQL is executed
    Then analysis.strategy_templates holds exactly 1 row with template_id "tpl-quality_dip_buyer" at version 2

  @AC-18 @FR-6 @FR-8
  Scenario: The ingest down migration leaves the fundamentals source in place
    Given the ingest seed migration has been applied
    When the ingest seed migration's down SQL is executed
    Then ingest.source_templates holds 0 rows with created_by "system"
    And ingest.signal_sources still holds the "fundamentals" row owned by "system"

  @AC-19 @FR-10
  Scenario: Seeded templates carry the system author and tpl- ids
    Given a database with all three seed migrations applied
    When the template tables are queried
    Then every seeded row has created_by "system" and a template_id starting with "tpl-"
    And the strategy template for "dip_buyer_vol_stop" has template_id "tpl-dip_buyer_vol_stop"

  @AC-20 @FR-11
  Scenario: The fundamentals composite template cannot drift from the system formula
    Given the seeded template "Fundamentals Value+Quality Composite (v1)"
    When its payload is compared with app/formulas/fundamentals_value_quality.py
    Then source, parameters, outputs and fundamentalInputs are equal

  @AC-21 @FR-11
  Scenario: A drifted fundamentals composite template is reported
    Given a template payload equal to the seeded "Fundamentals Value+Quality Composite (v1)" except "pe_good" default 11.0 instead of 10.0
    When it is compared with app/formulas/fundamentals_value_quality.py
    Then the comparison reports a difference at "parameters.pe_good.defaultValue"

  @AC-10 @FR-7
  Scenario: An admin can retire a seeded template
    Given the seeded formula template named "Kaufman Efficiency Ratio"
    When an admin calls ManageTemplate RETIRE on it
    Then ListTemplates as "bob" returns 8 formula templates and none is named "Kaufman Efficiency Ratio"

  @AC-11 @FR-8
  Scenario: The system fundamentals source exists after migration
    Given a freshly migrated ingest database in which the fundamentals producer has never run
    When ingest.signal_sources is queried for slug "fundamentals"
    Then exactly 1 row exists with user_id "system", source_type "derived" and display_name "Fundamentals Signal Producer"

  @AC-12 @FR-8
  Scenario: Seeding the fundamentals source never overwrites an existing row
    Given ingest.signal_sources already holds the system "fundamentals" source with reliability_weight 0.4
    When the ingest seed migration's up SQL is executed
    Then the "fundamentals" row still has reliability_weight 0.4

  @AC-13 @FR-9
  Scenario: Seeded payloads are at parity with their staging source instances
    Given the staging snapshot of the 9 formulas, 14 strategies and 4 sources captured on 2026-11-12
    When the parity check compares each seeded template payload with its snapshot instance
    Then it reports 0 differences outside the allowlist of formula-id rewrites, cleared active/live_enabled flags and owner/timestamp/id fields

  @AC-14 @FR-9
  Scenario: The parity check fails on a drifted payload
    Given the seeded "Kaufman Efficiency Ratio" template payload with its "period" default changed from 10 to 11
    When the parity check runs
    Then it exits non-zero and names "Kaufman Efficiency Ratio" and the field "parameters.period.defaultValue"

  @AC-15 @FR-1 @FR-2 @FR-5
  Scenario: The durable empty-catalog rule is replaced by the seeded-catalog rule
    Given docs/sdd/business-rules/platform.feature
    When the scenario tagged "@AC-15 @FR-7 @feature-224" is read
    Then it states that ListTemplates after migration returns the seeded catalog, not 0 templates
