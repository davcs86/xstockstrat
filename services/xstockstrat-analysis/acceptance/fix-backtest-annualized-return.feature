# Promoted business-rule suite for xstockstrat-analysis (Constitution C-16). Promoted from feature 149's
# acceptance.feature at launch; @feature-149 marks provenance. These are the guarantees a future
# feature must not regress (recon reads this suite; the design-adversary enforces it).

Feature: Analysis backtest — annualized return guarantees
  Behavioral rules the analysis backtest engine must preserve across features.

  @AC-1 @regression @feature-149
  Scenario: A one-year multi-symbol run annualizes to approximately its total return
    Given a completed backtest whose total_return is +0.2152 over a 1-year window
    And the aggregate equity curve is the concatenation of many per-symbol curves
    When the engine computes annualized_return for the run
    Then annualized_return is approximately 0.2152 (within 1%)
    And it is not the ~30x-under-scaled value 0.00603

  @AC-2 @regression @feature-149
  Scenario: Sub-year windows annualize geometrically
    Given a completed backtest whose total_return is +0.2152 over a 6-month window
    When the engine computes annualized_return for the run
    Then annualized_return equals (1 + 0.2152) ** 2 - 1 (within 1%)

  @AC-3 @regression @feature-149
  Scenario: Per-symbol evidence cells and the derived grade are unchanged
    Given a single-symbol evidence-cell metrics computation
    When the engine computes its metrics
    Then the cell's sharpe_ratio, max_drawdown, and win_rate are identical to the pre-fix values
    And the strategy's derived headline grade is unchanged
