Feature: seed-curated-templates
  As a platform admin, I want the curated staging formulas, signal sources and non-junk strategies
  seeded as templates by migration, so that every environment has a starting catalog users copy with
  instantiate_template.

  @AC-1 @FR-1
  Scenario: Formula catalog is seeded with the 9 curated formulas
    Given a database with all indicators migrations applied and no admin-authored templates
    When "bob" calls ListTemplates on indicators
    Then the response contains exactly 9 templates at version 1
    And their names are "Volatility Trailing Stop Direction", "Bollinger Squeeze Percentile", "Fundamentals Value+Quality Composite (template)", "SMA Trend Slope (fractional)", "Momentum Quality (Clenow)", "Kaufman Efficiency Ratio", "Mean-Reversion Z-Score", "rolling_zscore_v2" and "kaufman_efficiency_ratio_v2"

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
    Then the response contains exactly 14 templates, including "tpl-dip_buyer_vol_stop", "tpl-squeeze_breakout_trend", "tpl-fundamentals_macd_blend" and "tpl-range_mean_reversion_v2"
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

  # @AC-8 retired 2026-11-12 — superseded by @AC-23 (design.md; id never reused)

  @AC-9 @FR-6
  Scenario: The down migration removes only seeded rows
    Given the seeded catalog plus an admin-authored formula template "tpl-admin-custom"
    When the indicators seed migration's down SQL is executed
    Then indicators.formula_templates holds exactly 1 row with template_id "tpl-admin-custom"

  # @AC-16 retired 2026-11-12 — superseded by @AC-24 (design.md; id never reused)

  # @AC-17 retired 2026-11-12 — superseded by @AC-25 (design.md; id never reused)

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
    Given the seeded template "Fundamentals Value+Quality Composite (template)"
    When its payload is compared with app/formulas/fundamentals_value_quality.py
    Then source, parameters, outputs and fundamentalInputs are equal

  @AC-21 @FR-11
  Scenario: A drifted fundamentals composite template is reported
    Given a template payload equal to the seeded "Fundamentals Value+Quality Composite (template)" except "pe_good" default 11.0 instead of 10.0
    When it is compared with app/formulas/fundamentals_value_quality.py
    Then the comparison reports a difference at "parameters.pe_good.defaultValue"

  # @AC-10 retired 2026-11-12 — superseded by @AC-26 (design.md; id never reused)

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

  # @AC-13 retired 2026-11-12 — superseded by @AC-35 (design.md; id never reused)

  @AC-14 @FR-9
  Scenario: The parity check fails on a drifted payload
    Given the staging export and a seeded "Kaufman Efficiency Ratio" template payload with its "period" default changed from 10 to 11
    When the parity check runs
    Then it exits non-zero and names "Kaufman Efficiency Ratio" and the field "parameters.period.defaultValue"

  # @AC-15 retired 2026-11-12 — superseded by @AC-22 (design.md; id never reused)

  # Added by /sdd-design (2026-11-12, design.md)

  @AC-22 @FR-1 @FR-2 @FR-5 @FR-7
  Scenario: The catalog holds the seeded set after migration
    Given a database with all migrations applied and no admin-authored templates
    When "bob" calls ListTemplates on indicators, analysis and ingest
    Then the responses contain 9, 14 and 4 templates respectively
    And every one has a template_id starting with "tpl-" and read_only true

  @AC-23 @FR-6
  Scenario: Replaying a seed migration keeps a row a later migration moved to version 2
    Given the indicators seed has been applied and "tpl-kaufman_efficiency_ratio" was then set to version 2 by SQL
    When the indicators seed migration's up SQL is executed a second time
    Then indicators.formula_templates still holds 9 rows
    And "tpl-kaufman_efficiency_ratio" is still at version 2

  @AC-24 @FR-6
  Scenario Outline: Replaying a seed migration does not un-retire a row
    Given the <service> seed has been applied and one seeded row was then given a retired_at by SQL
    When the <service> seed migration's up SQL is executed a second time
    Then <table> still holds <count> rows
    And that row still has a non-null retired_at

    Examples:
      | service    | table                       | count |
      | indicators | indicators.formula_templates | 9     |
      | analysis   | analysis.strategy_templates | 14    |
      | ingest     | ingest.source_templates     | 4     |

  @AC-25 @FR-6
  Scenario: A down migration keeps a seeded row that is no longer at version 1
    Given the seeded strategy catalog in which "tpl-quality_dip_buyer" was set to version 2 by SQL
    When the analysis strategy-template seed's down SQL is executed
    Then analysis.strategy_templates holds exactly 1 row with template_id "tpl-quality_dip_buyer" at version 2

  @AC-26 @FR-12
  Scenario Outline: An admin cannot update or retire a system template
    Given the seeded <kind> template "<template_id>"
    When an admin calls ManageTemplate <operation> on it
    Then the call fails with PERMISSION_DENIED "system template '<template_id>' is read-only"
    And the row's version, payload and retired_at are unchanged

    Examples:
      | kind     | template_id                  | operation |
      | formula  | tpl-kaufman_efficiency_ratio | UPDATE    |
      | formula  | tpl-kaufman_efficiency_ratio | RETIRE    |
      | strategy | tpl-quality_dip_buyer        | UPDATE    |
      | strategy | tpl-quality_dip_buyer        | RETIRE    |
      | source   | tpl-prnewswire_releases      | UPDATE    |
      | source   | tpl-prnewswire_releases      | RETIRE    |

  @AC-27 @FR-12
  Scenario: Creating a template under a seeded id is refused
    Given the seeded formula template "tpl-kaufman_efficiency_ratio"
    When an admin calls ManageTemplate CREATE with template_id "tpl-kaufman_efficiency_ratio"
    Then the call fails with ALREADY_EXISTS

  @AC-28 @FR-12
  Scenario: An admin-authored template stays editable
    Given a formula template "tpl-admin-custom" created by admin "admin1"
    When "admin1" calls ManageTemplate UPDATE and then RETIRE on it
    Then the UPDATE returns version 2 and the RETIRE sets retired_at
    And ListTemplates returns it with read_only false before the retire

  @AC-29 @FR-15
  Scenario: Config-ui shows system templates as read-only
    Given the config-ui templates page lists system template "tpl-quality_dip_buyer" and admin template "tpl-admin-custom"
    When an admin opens the page
    Then the "tpl-quality_dip_buyer" row shows a "System" badge and no Edit or Retire action
    And the "tpl-admin-custom" row shows Edit and Retire

  @AC-30 @FR-15
  Scenario: The agent reports read-only templates
    Given the seeded strategy template "tpl-quality_dip_buyer"
    When list_templates is called with kind "strategy"
    Then its meta contains "readOnly": true

  @AC-31 @FR-13
  Scenario: The blend strategy is seeded for admin@localhost
    Given a migrated database in which user "admin@localhost" exists and owns no strategy
    When analysis.strategies is queried for that user
    Then exactly 1 row exists with strategy_id "fundamentals_macd_blend", active true and live_enabled false
    And every custom-formula component in its definition has formula_id "d1ff5e6b-6d9c-589d-b95e-defd862c702b"

  @AC-32 @FR-13
  Scenario: Seeding never touches a blend the admin already owns
    Given "admin@localhost" already owns "fundamentals_macd_blend" with live_enabled true and display_name "mine"
    When the blend-strategy migration's up SQL is executed
    Then the row still has live_enabled true and display_name "mine"

  @AC-33 @FR-13
  Scenario: Seeding is skipped when admin@localhost does not exist
    Given a database in which no user has email "admin@localhost"
    When the blend-strategy migration's up SQL is executed
    Then it succeeds and analysis.strategies holds 0 rows with strategy_id "fundamentals_macd_blend"

  @AC-34 @FR-13
  Scenario: The blend-strategy down migration leaves the strategy in place
    Given the blend strategy seeded for "admin@localhost"
    When the blend-strategy migration's down SQL is executed
    Then the "fundamentals_macd_blend" row for that user still exists

  @AC-35 @FR-9
  Scenario: Seeded payloads are at parity with the staging export
    Given the committed staging export and the four seed migrations
    When the parity check runs
    Then it reports 0 differences outside the allowlist of formula-id rewrites, omitted proto defaults, absent owner/state fields, the blend template's strategy_id "fundamentals_macd_blend_copy" and the composite template's name

  @AC-36 @FR-9
  Scenario: Seeded strategy payloads carry no owner or state fields
    Given the 14 seeded strategy template payloads
    When each payload's keys are inspected
    Then none contains "user_id", "origin", "warnings", "active" or "live_enabled"

  @AC-37 @FR-14
  Scenario: A non-admin can instantiate the blend template without choosing an id
    Given the seeded template "tpl-fundamentals_macd_blend" and non-admin "bob" who owns no strategy
    When "bob" instantiates it with no strategy_id
    Then "bob" owns strategy "fundamentals_macd_blend_copy" with active false and live_enabled false
    And its "fscore" component points to "bob"'s private copy of "Fundamentals Value+Quality Composite (template)", not to "d1ff5e6b-6d9c-589d-b95e-defd862c702b"

  @AC-38 @FR-3
  Scenario: Every seeded strategy template instantiates into a valid definition
    Given the 14 seeded strategy templates and the 9 seeded formula templates
    When non-admin "bob" instantiates each one
    Then all 14 calls succeed and each resulting definition passes strategy validation with every custom-formula component pointing to one of "bob"'s formula copies

  @AC-39 @FR-6
  Scenario: A seed migration fails when a seeded id is held by a non-system row
    Given indicators.formula_templates already holds "tpl-kaufman_efficiency_ratio" with created_by "admin1"
    When the indicators seed migration's up SQL is executed
    Then it fails with an error naming a seeded template_id held by a non-system row

  @AC-40 @FR-8
  Scenario: A user-held fundamentals slug gains no system holder
    Given ingest.signal_sources holds "fundamentals" owned by user "u-1" and no system row
    When the ingest seed migration's up SQL is executed
    Then ingest.signal_sources holds 0 rows with slug "fundamentals" and user_id "system"
