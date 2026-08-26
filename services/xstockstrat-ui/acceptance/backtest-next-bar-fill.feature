# Promoted business-rule suite for xstockstrat-ui (Constitution C-16). Promoted from feature 151's
# acceptance.feature at launch; @feature-151 marks provenance. Do not hand-author or rewrite.

Feature: backtest-next-bar-fill (ui)
  Durable acceptance guarantees for rendered next-bar-open backtest diagnostics.

  @AC-11 @FR-5 @feature-151
  Scenario: A next-bar fill row shows the prior bar's signal beside the current bar's conviction
    Given a next-bar-open run where a signal on bar i fills on bar (i+1)
    When the per-bar diagnostics are rendered
    Then diags[i+1].action reflects bar i's signal
    And diags[i+1].conviction reflects bar (i+1)'s own decision
    And the derived grade is unaffected because grade math never reads conviction
