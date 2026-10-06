Feature: private-by-default-templates
  As a platform owner, I want every user-authored object private to its owner, with no public concept,
  and an admin-curated template catalog users instantiate into private copies,
  so that no user can read, execute or be influenced by another user's strategies, formulas or signals.

  @AC-1 @FR-1
  Scenario: Another user's formulas are invisible even if formerly public
    Given user "alice" owns formula "f-zscore" with source "result = {'value': 1}" that was is_public=true before migration
    When user "bob" calls GetFormula with formula_id "f-zscore"
    Then the call fails with gRPC status NOT_FOUND
    And ExecuteFormula with formula_id "f-zscore" as "bob" fails with NOT_FOUND

  @AC-2 @FR-1
  Scenario: ListFormulas returns only the caller's own and system formulas
    Given "alice" owns formulas "f-a1" and "f-a2", "bob" owns "f-b1", and system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b" exists
    When "bob" calls ListFormulas with author_filter "alice" and include_public true
    Then the response contains exactly formula ids "f-b1" and "d1ff5e6b-6d9c-589d-b95e-defd862c702b"

  @AC-3 @FR-1
  Scenario: Setting is_public has no effect
    Given "alice" registers formula "f-new" with is_public true
    When "bob" calls GetFormula with formula_id "f-new"
    Then the call fails with NOT_FOUND
    And the stored FormulaDefinition for "f-new" read by "alice" has is_public false

  @AC-4 @FR-2
  Scenario: Body author cannot impersonate another user or the system
    Given the caller header x-user-id is "bob"
    When "bob" calls RegisterFormula with author "system" and name "sneaky"
    Then the stored formula "sneaky" has author "bob"

  @AC-5 @FR-3
  Scenario: analysis cannot execute a formula its strategy owner does not own
    Given "bob" owns strategy "s-1" whose component references "alice"'s private formula "f-zscore"
    When the analysis live loop evaluates "s-1"
    Then indicators receives the ExecuteFormula call with x-user-id "bob" and no x-internal-caller header
    And the component is skipped and the strategy reports warning "formula f-zscore not readable by owner"

  @AC-6 @FR-3 @FR-1
  Scenario: The fundamentals loop still runs the system scoring formula
    Given analysis.fundsignal.scoring_formula_id is empty (built-in default)
    When the fundamentals signal loop scores symbol "AAPL"
    Then ExecuteFormula for system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b" succeeds

  @AC-7 @FR-4
  Scenario: Users manage their own signal sources without admin scope
    Given "bob" has no ADMIN scope bit
    When "bob" calls ManageSignalSource CREATE with slug "my-newsletter"
    Then the source "my-newsletter" is created with user_id "bob"
    And "alice" calling ListSignalSources does not see "my-newsletter"

  @AC-8 @FR-4
  Scenario: Two users may use the same source slug
    Given "alice" owns signal source "motley-fool"
    When "bob" creates signal source "motley-fool"
    Then both sources exist, one owned by "alice" and one by "bob"

  @AC-9 @FR-5
  Scenario: Ingested signals belong to the source owner and dedup per owner
    Given "alice" and "bob" each own source "motley-fool"
    When both ingest a BUY signal for "NVDA" from "motley-fool" at "2026-10-06T14:00:00Z"
    Then two signal rows exist, one with user_id "alice" and one with user_id "bob"
    And QuerySignals as "bob" for symbol "NVDA" returns exactly 1 signal

  @AC-10 @FR-5
  Scenario: A user cannot ingest into another user's source
    Given "alice" owns source "alice-feed" and "bob" owns no source with that slug
    When "bob" calls IngestSignal with source "alice-feed"
    Then the call fails with NOT_FOUND and no signal row is written

  @AC-11 @FR-6
  Scenario: Live loop signal eligibility sees only the owner's signals
    Given "bob" owns signal_eligible strategy "s-sig" and "alice" ingested a BUY signal for "TSLA"
    And "bob" has no signals for "TSLA"
    When the live loop evaluates "s-sig" for "TSLA"
    Then no signal-driven opportunity for "TSLA" is created for "bob"

  @AC-12 @FR-6
  Scenario: Attribution excludes other users' signals
    Given "alice" ingested signals from source "alice-feed"
    When "bob" calls GetAttribution with source_id "alice-feed"
    Then the response contains 0 attributed signals

  @AC-13 @FR-7
  Scenario: Only admins can author templates
    Given "bob" has no ADMIN scope bit
    When "bob" calls ManageTemplate CREATE with kind FORMULA and name "Z-Score"
    Then the call fails with PERMISSION_DENIED

  @AC-14 @FR-7
  Scenario: Any user can browse the catalog and updates bump the version
    Given an admin created formula template "tpl-zscore" (version 1)
    When the admin updates "tpl-zscore" source
    Then ListTemplates as "bob" returns "tpl-zscore" with version 2

  @AC-15 @FR-7
  Scenario: Catalog starts empty after migration
    Given a database migrated from the pre-feature schema with 8 public formulas
    When "bob" calls ListTemplates
    Then the response contains 0 templates

  @AC-16 @FR-8
  Scenario: Instantiation creates an independent private snapshot
    Given formula template "tpl-zscore" at version 2
    When "bob" calls InstantiateTemplate for "tpl-zscore"
    Then a new formula owned by "bob" exists with origin_template_id "tpl-zscore" and origin_template_version 2
    And "alice" calling GetFormula on the new formula id fails with NOT_FOUND

  @AC-17 @FR-8
  Scenario: Template updates never mutate existing instances
    Given "bob" instantiated "tpl-zscore" at version 2 into formula "f-bob-z"
    When the admin updates "tpl-zscore" to version 3 with a new source
    Then "f-bob-z" source is unchanged
    And reading "f-bob-z" reports origin version 2 and an update-available indicator with latest version 3

  @AC-18 @FR-9
  Scenario: Strategy template instantiation deep-copies referenced formulas
    Given strategy template "tpl-meanrev" whose two components reference formula templates "tpl-zscore" and "tpl-er"
    When "bob" instantiates "tpl-meanrev"
    Then "bob" owns a new inactive, non-live strategy and 2 new private formulas copied from "tpl-zscore" and "tpl-er"
    And each strategy component's formula_id points to "bob"'s copies

  @AC-19 @FR-9
  Scenario: A failed deep copy leaves nothing behind
    Given strategy template "tpl-meanrev" whose second formula copy fails
    When "bob" instantiates "tpl-meanrev"
    Then the call fails
    And "bob" owns 0 new strategies and 0 new formulas visible via ListFormulas

  @AC-20 @FR-9
  Scenario: Strategy id collision on instantiation
    Given "bob" already owns strategy "mean_reversion" and template "tpl-meanrev" proposes strategy_id "mean_reversion"
    When "bob" instantiates "tpl-meanrev" without a strategy_id override
    Then the new strategy has strategy_id "mean_reversion_2" and the existing "mean_reversion" is unchanged

  @AC-21 @FR-10
  Scenario: Same strategy_id for two users does not share scores or backtests
    Given "alice" and "bob" each own strategy "mean_reversion"
    When a backtest completes for "alice"'s "mean_reversion"
    Then "bob"'s strategy score and ListBacktests for "mean_reversion" are unchanged
    And "bob" calling GetBacktest with "alice"'s backtest_id fails with PERMISSION_DENIED

  @AC-22 @FR-11
  Scenario: Migration preserves data and makes public formulas private
    Given 8 formulas with is_public=true authored by "user-a@example.test", "user-b" and "system"
    When the migration runs
    Then all 8 formulas still exist with unchanged source and author
    And none of the non-system formulas are readable by a different user

  @AC-23 @FR-11
  Scenario: System special-cases are unchanged
    Given system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b" and "bob" owns live strategy "fundamentals_macd_blend"
    When an admin calls UpdateFormula on system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b"
    Then the call fails with PERMISSION_DENIED as before
    And "bob" calling ManageStrategy DEACTIVATE on "fundamentals_macd_blend" is refused as before

  @AC-24 @FR-12
  Scenario: UI has no public controls and offers templates
    Given "bob" is signed in to /insights
    When "bob" opens the formulas library
    Then no "Public" checkbox, badge or filter is rendered
    And a "Templates" entry in PLATFORM_SUBNAV lists the catalog with a "Use template" action

  @AC-25 @FR-12
  Scenario: Agent tools expose templates and drop public arguments
    Given the agent MCP tool catalog at GET /api/tools
    When the catalog is listed
    Then "list_templates" and "instantiate_template" are present
    And "manage_formula" has no "is_public" parameter and "list_formulas" has no "include_public" parameter

  @AC-26 @FR-6
  Scenario: System-owned fundamentals signals are visible to every user
    Given the fundamentals producer emitted a BUY signal for "MSFT" under a source owned by "system"
    And "bob" owns signal_eligible strategy "s-fund"
    When the live loop evaluates "s-fund" for "MSFT"
    Then the "system" signal for "MSFT" is consumed for "bob"
    And "bob" calling ManageSignalSource UPDATE on that system source fails with PERMISSION_DENIED

  @AC-27 @FR-11
  Scenario: Global signal data is backfilled to the seed user
    Given SEED_USER_ID is "seed-user" and 3 pre-feature signal sources with 120 signals exist
    When the migration runs
    Then all 3 sources and 120 signals have user_id "seed-user", except fundamentals-producer sources, which have user_id "system"

  @AC-28 @FR-13
  Scenario: Admins can read but not change another user's objects
    Given "admin" has the ADMIN scope bit and "alice" owns private formula "f-zscore"
    When "admin" calls GetFormula for "f-zscore"
    Then the formula is returned and an audit ledger event records "admin" reading "f-zscore"
    And "admin" calling UpdateFormula or DeleteFormula on "f-zscore" fails with PERMISSION_DENIED
    And "admin" calling ExecuteFormula on "f-zscore" fails with PERMISSION_DENIED

  @AC-29 @FR-6
  Scenario: Opportunity provenance and screener signal filter exclude other users' signals
    Given "alice" ingested a BUY signal for "AMD" from her source "alice-feed" and "bob" owns no source "alice-feed"
    When "bob" calls ListOpportunities and ScreenSymbols with signal_sources ["alice-feed"]
    Then no opportunity for "bob" lists provenance "alice-feed"
    And the screen returns 0 symbols matched by signal source "alice-feed"

  @AC-30 @FR-3
  Scenario: Registering a strategy that references an unreadable formula warns at write time
    Given "alice" owns private formula "f-zscore"
    When "bob" calls ManageStrategy REGISTER with a component referencing formula_id "f-zscore"
    Then the returned StrategyDefinition.warnings contains "formula f-zscore not readable by owner"

  @AC-31 @FR-7
  Scenario: Retiring a template hides it but leaves instances intact
    Given "bob" instantiated formula template "tpl-zscore" into formula "f-bob-z"
    When the admin retires "tpl-zscore"
    Then ListTemplates as "bob" does not contain "tpl-zscore"
    And GetFormula "f-bob-z" as "bob" still returns its source with origin_template_id "tpl-zscore"

  @AC-32 @FR-12
  Scenario: Agent docs and strat-lab skill stay in parity with the tool contract
    Given the agent tool catalog includes "list_templates" and "instantiate_template"
    When docs/runbooks/mcp-tools.md and plugins/strat-lab/skills/backtest/SKILL.md are checked
    Then both list "list_templates" and "instantiate_template" and neither mentions "is_public" or "include_public"

  @AC-33 @FR-6
  Scenario: A user cannot write as the system owner
    Given "mallory" sends x-user-id "system" without the analysis-fundsignal internal-caller grant
    When "mallory" calls IngestSignal into a "system" source
    Then the call fails with PERMISSION_DENIED and no signal row is written

  @AC-34 @FR-9
  Scenario: Caller-chosen strategy id on instantiation
    Given "bob" already owns strategy "mean_reversion"
    When "bob" instantiates "tpl-meanrev" with strategy_id "mean_reversion"
    Then the call fails with ALREADY_EXISTS and no strategy or formula is created

  @AC-35 @FR-14
  Scenario: Two users with the same mcp_client slug use their own credentials
    Given "alice" and "bob" each own mcp_client source "acme-mcp" with bearers "tok-a" and "tok-b"
    When the ingest poller polls both sources
    Then the request for "alice"'s source carries "Authorization: Bearer tok-a" and "bob"'s carries "Bearer tok-b"
    And GetConfig, ListKeys and WatchConfig never return "tok-a" or "tok-b" in plaintext to any caller

  @AC-36 @FR-4
  Scenario: System slugs are reserved
    Given a "system"-owned source "fundamentals" exists
    When "bob" calls ManageSignalSource REGISTER with slug "fundamentals"
    Then the call fails with ALREADY_EXISTS and no source owned by "bob" exists
