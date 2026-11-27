# Promoted from docs/roadmap/features/309-fix-fundsignal-scoring-correctness/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-309` tag.
# Durable business rules xstockstrat-analysis guarantees for fundamentals-signal scoring: absent metrics
# are never fed to the formula as zeros, a lone scored symbol is not labelled buy, and an explicit
# conviction of 0.0 stays 0.0 — a rule enters only by promotion, never by hand-authoring.

Feature: fix-fundsignal-scoring-correctness (bug fix)
  Regression guard for clustered defect reports: fundamentals signals are scored from present data
  only, directions reflect the score, and explicit zero conviction stays zero.

  # guards: docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md
  @AC-1 @regression @feature-309
  Scenario: The formula-path producer omits absent metrics from the formula input
    Given analysis.fundsignal.scoring_formula_id is the system "value_quality" formula
    And a symbol whose fundamentals row lists "pe_ratio", "pb_ratio", "roe", "debt_to_equity" and "eps" in missing_metrics
    And its dividend_yield is 0.013
    When a producer cycle scores that symbol
    Then the ExecuteFormula input contains only "dividend_yield" with value 0.013
    And no pb or debt_to_equity sub-score of 1.0 contributes to the composite

  # guards: docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md
  @AC-2 @regression @feature-309
  Scenario: A lone low-scoring symbol is not labelled buy
    Given analysis.fundsignal.universe_source is "explicit" with one symbol
    And that symbol's fundamentals are pe_ratio 40, roe 0.0 and eps -1
    And no fundamentals scores are stored for the day
    When a non-dry-run producer cycle runs
    Then the emitted signal for that symbol does not carry direction "buy"

  # guards: docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md
  @AC-3 @regression @feature-309
  Scenario: An explicit conviction of 0.0 is scored as 0.0
    Given an ExternalSignal with direction "buy" and conviction 0.0 is ingested for a weighted source
    When compute_signal_score scores that source's signals for a screener or backtest
    Then the signal adds 0.0 to buy_conviction, not 0.5 times the source weight
