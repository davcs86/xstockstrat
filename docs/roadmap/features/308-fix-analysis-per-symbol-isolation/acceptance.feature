Feature: fix-analysis-per-symbol-isolation (bug fix)
  Regression guard for clustered defect reports: one failing symbol or candidate must degrade only
  itself in xstockstrat-analysis per-symbol fan-outs.

  # guards: docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md
  @AC-1 @regression
  Scenario: A candidate whose evaluation raises degrades to its own row and healthy candidates are materialized
    Given a user whose opportunity candidates are "AAPL", "MSFT" and "NVDA"
    And evaluate_conditions_traced raises FormulaExecutionError for "NVDA"
    When _compute_opportunities runs for that user
    Then the compute does not raise
    And opportunity rows are written for "AAPL" and "MSFT"
    And the "NVDA" row is degraded with a fault marker instead of aborting the compute

  # guards: docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md
  # wording amended 2026-11-20 (C-16 operator sign-off, design gate option A; design.md § 2)
  @AC-2 @regression
  Scenario: EvaluateReadiness returns and caches healthy symbols when one symbol's compute raises
    Given compute_readiness_row raises ZeroDivisionError for "NVDA"
    When EvaluateReadiness is called with symbols "AAPL", "MSFT" and "NVDA"
    Then the RPC succeeds
    And readiness is returned for "AAPL" and "MSFT"
    And "NVDA" is returned as an empty SymbolReadiness (0 of 0 conditions; the proto has no unavailable field)
    And the "AAPL" and "MSFT" SLOW rows are persisted to readiness_cache
    And no readiness_cache row is staged for "NVDA"

  # guards: docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md
  # outcome split by site, amended 2026-11-20 (C-16 operator sign-off, design gate option A; design.md § 2)
  @AC-3 @regression
  Scenario: An indicators outage on one strategy component does not discard the user's readiness batch
    Given indicators ExecuteFormula returns UNAVAILABLE for one component of strategy "s1" on "NVDA"
    And the user's other strategy/symbol pairs evaluate normally
    When the readiness refresh kick or the readiness materializer tick runs for that user
    Then readiness rows are written for every healthy pair
    And the failing "s1"/"NVDA" pair is cached as the bar_epoch -1 data-unavailable sentinel (UNKNOWN, 300 s cooldown), never as a fresh success
    When the opportunity surgical retry runs for that user
    Then the heal rows of the healthy symbols are written
    And the failing pair keeps its "unavailable" provenance, no readiness_cache row is written for it, and one WARN tally names it
