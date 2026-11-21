# Promoted from docs/roadmap/features/335-seed-curated-templates/acceptance.feature
# Source: @AC-3, @AC-25, @AC-31, @AC-32, @AC-33, @AC-34 — analysis scenarios
Feature: seed-curated-templates (analysis)
  Acceptance scenarios for the xstockstrat-analysis service promoted from feature 335.
  Covers the seeded strategy template catalog, the down migration that keeps a moved-on template version,
  and the blend strategy seeded for admin@localhost.

  @AC-3 @FR-2 @feature-335
  Scenario: Strategy catalog is seeded with the non-junk strategies only
    Given a database with all analysis migrations applied and no admin-authored templates
    When "bob" calls ListTemplates on analysis
    Then the response contains exactly 14 templates, including "tpl-dip_buyer_vol_stop", "tpl-squeeze_breakout_trend", "tpl-fundamentals_macd_blend" and "tpl-range_mean_reversion_v2"
    And it contains no template for "zz_fscore_probe", "dbg_regime_voo_inverted", "diag_formula_probe", "jjjjjjj", "bbbb", "aaaa", "rsi20", "range_mean_reversion" or "range_mean_reversion_v3"

  @AC-25 @FR-6 @feature-335
  Scenario: A down migration keeps a seeded row that is no longer at version 1
    Given the seeded strategy catalog in which "tpl-quality_dip_buyer" was set to version 2 by SQL
    When the analysis strategy-template seed's down SQL is executed
    Then analysis.strategy_templates holds exactly 1 row with template_id "tpl-quality_dip_buyer" at version 2

  @AC-31 @FR-13 @feature-335
  Scenario: The blend strategy is seeded for admin@localhost
    Given a migrated database in which user "admin@localhost" exists and owns no strategy
    When analysis.strategies is queried for that user
    Then exactly 1 row exists with strategy_id "fundamentals_macd_blend", active true and live_enabled false
    And every custom-formula component in its definition has formula_id "d1ff5e6b-6d9c-589d-b95e-defd862c702b"

  @AC-32 @FR-13 @feature-335
  Scenario: Seeding never touches a blend the admin already owns
    Given "admin@localhost" already owns "fundamentals_macd_blend" with live_enabled true and display_name "mine"
    When the blend-strategy migration's up SQL is executed
    Then the row still has live_enabled true and display_name "mine"

  @AC-33 @FR-13 @feature-335
  Scenario: Seeding is skipped when admin@localhost does not exist
    Given a database in which no user has email "admin@localhost"
    When the blend-strategy migration's up SQL is executed
    Then it succeeds and analysis.strategies holds 0 rows with strategy_id "fundamentals_macd_blend"

  @AC-34 @FR-13 @feature-335
  Scenario: The blend-strategy down migration leaves the strategy in place
    Given the blend strategy seeded for "admin@localhost"
    When the blend-strategy migration's down SQL is executed
    Then the "fundamentals_macd_blend" row for that user still exists
