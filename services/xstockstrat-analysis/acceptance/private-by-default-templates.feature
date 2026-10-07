# Promoted from docs/roadmap/features/224-private-by-default-templates/acceptance.feature
# Source: @AC-5, @AC-11, @AC-12, @AC-20, @AC-21, @AC-29, @AC-30, @AC-34, @AC-37 — analysis scenarios
Feature: private-by-default-templates (analysis)
  Acceptance scenarios for the xstockstrat-analysis service promoted from feature 224.
  Covers owner-scoped formula execution and write-time warnings, owner-scoped signal consumption
  (live loop, attribution, opportunities, screener), owner-keyed scores/backtests, strategy-id
  handling on template instantiation, and the fail-closed fundamentals scoring formula.

  @AC-5 @FR-3 @feature-224
  Scenario: analysis cannot execute a formula its strategy owner does not own
    Given "bob" owns strategy "s-1" whose component references "alice"'s private formula "f-zscore"
    When the analysis live loop evaluates "s-1"
    Then indicators receives the ExecuteFormula call with x-user-id "bob" and no x-internal-caller header
    And the component is skipped and the strategy reports warning "formula f-zscore not readable by owner"

  @AC-11 @FR-6 @feature-224
  Scenario: Live loop signal eligibility sees only the owner's signals
    Given "bob" owns signal_eligible strategy "s-sig" and "alice" ingested a BUY signal for "TSLA"
    And "bob" has no signals for "TSLA"
    When the live loop evaluates "s-sig" for "TSLA"
    Then no signal-driven opportunity for "TSLA" is created for "bob"

  @AC-12 @FR-6 @feature-224
  Scenario: Attribution excludes other users' signals
    Given "alice" ingested signals from source "alice-feed"
    When "bob" calls GetAttribution with source_id "alice-feed"
    Then the response contains 0 attributed signals

  @AC-20 @FR-9 @feature-224
  Scenario: Strategy id collision on instantiation
    Given "bob" already owns strategy "mean_reversion" and template "tpl-meanrev" proposes strategy_id "mean_reversion"
    When "bob" instantiates "tpl-meanrev" without a strategy_id override
    Then the new strategy has strategy_id "mean_reversion_2" and the existing "mean_reversion" is unchanged

  @AC-21 @FR-10 @feature-224
  Scenario: Same strategy_id for two users does not share scores or backtests
    Given "alice" and "bob" each own strategy "mean_reversion"
    When a backtest completes for "alice"'s "mean_reversion"
    Then "bob"'s strategy score and ListBacktests for "mean_reversion" are unchanged
    And "bob" calling GetBacktest with "alice"'s backtest_id fails with PERMISSION_DENIED

  @AC-29 @FR-6 @feature-224
  Scenario: Opportunity provenance and screener signal filter exclude other users' signals
    Given "alice" ingested a BUY signal for "AMD" from her source "alice-feed" and "bob" owns no source "alice-feed"
    When "bob" calls ListOpportunities and ScreenSymbols with signal_sources ["alice-feed"]
    Then no opportunity for "bob" lists provenance "alice-feed"
    And the screen returns 0 symbols matched by signal source "alice-feed"

  @AC-30 @FR-3 @feature-224
  Scenario: Registering a strategy that references an unreadable formula warns at write time
    Given "alice" owns private formula "f-zscore"
    When "bob" calls ManageStrategy REGISTER with a component referencing formula_id "f-zscore"
    Then the returned StrategyDefinition.warnings contains "formula f-zscore not readable by owner"

  @AC-34 @FR-9 @feature-224
  Scenario: Caller-chosen strategy id on instantiation
    Given "bob" already owns strategy "mean_reversion"
    When "bob" instantiates "tpl-meanrev" with strategy_id "mean_reversion"
    Then the call fails with ALREADY_EXISTS and no strategy or formula is created

  @AC-37 @FR-3 @FR-6 @feature-224
  Scenario: Fundamentals scan fails closed on a non-system scoring formula
    Given "alice" owns private formula "f-alice-score"
    And analysis.fundsignal.scoring_formula_id is set to "f-alice-score"
    When the fundamentals signal loop scores symbol "AAPL" on the scheduled path or via RunFundamentalsScan
    Then no IngestSignal call is made and no fundsignal_emitted row is written
    And an ERROR is logged and a notify alert with severity ALERT_SEVERITY_ERROR is emitted
    And the built-in scorer is not used
