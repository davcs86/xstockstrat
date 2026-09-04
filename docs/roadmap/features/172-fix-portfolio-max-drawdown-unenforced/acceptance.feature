Feature: fix-portfolio-max-drawdown-unenforced (bug fix)
  Regression guard for comment-audit report item 2: portfolio.risk.max_drawdown_pct must not be
  silently read-then-discarded. The design gate picks Path A (enforce) or Path B (document honestly);
  the launched scenario is refined to the chosen path.

  @AC-1 @regression @path-A-enforce
  Scenario: A drawdown beyond the configured maximum triggers the enforced control
    Given portfolio.risk.max_drawdown_pct is configured to 0.02
    And a portfolio whose peak-to-current drawdown exceeds 2%
    When the risk evaluation runs
    Then the configured drawdown control fires (halt and/or alert), rather than being a no-op

  @AC-2 @regression @path-B-document
  Scenario: The key is honestly surfaced as not-enforced when enforcement is deferred
    Given the drawdown-halt logic has not been implemented
    When an operator inspects the portfolio config-key documentation for max_drawdown_pct
    Then it is marked "Documented, not yet implemented" (parity with trading.risk.daily_loss_limit)
    And the service code no longer reads the value only to discard it without an explaining contract
