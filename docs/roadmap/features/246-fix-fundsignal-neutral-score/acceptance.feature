Feature: fix-fundsignal-neutral-score (bug fix)
  Regression guard for docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md:
  the fundamentals producer emits fabricated 0.5 scores for symbols with no data.

  Background:
    Given analysis.fundsignal.scoring_formula_id is "" (built-in scorer)
    And analysis.fundsignal.min_conviction_to_emit is 0.0
    And analysis.fundsignal.buy_quantile is 0.80 and analysis.fundsignal.sell_quantile is 0.20

  @AC-1 @FR-1 @regression
  Scenario: Symbols with no usable fundamentals are not scored, ranked or emitted
    Given analysis.fundsignal.universe_source is "explicit" with explicit_symbols "SPY,QQQ,IWM,DIA,VOO,MSFT"
    And "SPY", "QQQ", "IWM", "DIA" and "VOO" each list "pe_ratio", "pb_ratio", "roe", "debt_to_equity" and "eps" in missing_metrics
    And "MSFT" has pe_ratio 20.0, roe 0.30 and eps 10.0
    And "MSFT" lists "pb_ratio" and "debt_to_equity" in missing_metrics, and not "pe_ratio", "roe" or "eps"
    When a non-dry-run fundamentals producer cycle runs
    Then exactly one ExternalSignal is sent to ingest, for "MSFT"
    And no score, direction or analysis.fundsignal_emitted row exists for "SPY", "QQQ", "IWM", "DIA" or "VOO"
    And exactly one analysis.fundsignal_emitted row exists, for "MSFT", with direction "buy"

  @AC-2 @FR-2 @regression
  Scenario: A metric reported as zero is scored, not treated as absent
    Given "ZRO" has pe_ratio 20.0 and roe 0.0
    And "ZRO" lists "pb_ratio", "debt_to_equity" and "eps" in missing_metrics, and not "pe_ratio" or "roe"
    When the built-in scorer scores "ZRO"
    Then the "ZRO" score is 0.30 within 1e-9
