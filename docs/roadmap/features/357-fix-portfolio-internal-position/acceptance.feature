Feature: fix-portfolio-internal-position (bug fix)
  Regression guard for defect report docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md: portfolio internal position reads stop at the first 500 rows.

  @AC-1 @regression
  Scenario Outline: Internal position readers cover every position past the first 500
    Given user "u-1" holds 501 positions in trading mode PAPER, the 501st ordered last by (symbol, trading_mode, account_id)
    When <reader> runs for "u-1" in PAPER
    Then the result is computed over all 501 positions, including the 501st

    Examples:
      | reader            |
      | GetPortfolio      |
      | GetPnL            |
      | broadcastSnapshot |
      | checkRiskLimits   |

  @AC-2 @regression
  Scenario: A page error while reading positions is not returned as a complete result
    Given user "u-1" holds 501 positions in PAPER and the repository read of the second page fails
    When GetPnL runs for "u-1" in PAPER
    Then GetPnL returns an error instead of a P&L computed over the first 500 positions
