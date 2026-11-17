Feature: fix-portfolio-internal-position (bug fix)
  Regression guard for defect report docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md: portfolio internal position reads stop at the first 500 rows.

  @AC-1 @FR-1 @FR-2 @FR-3 @FR-4 @regression
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

  @AC-2 @FR-5 @regression
  Scenario Outline: A page error in an RPC reader is returned, not a partial result
    Given user "u-1" holds 501 positions in PAPER and the repository read of the second page fails
    When <reader> runs for "u-1" in PAPER
    Then <reader> returns an error instead of a result computed over the first 500 positions

    Examples:
      | reader       |
      | GetPortfolio |
      | GetPnL       |

  @AC-3 @FR-1 @regression
  Scenario: Account-scoped GetPortfolio covers every position of that account past the first 500
    Given user "u-1" holds 501 positions in PAPER on account "acct-a" and 3 positions in PAPER on account "acct-b"
    When GetPortfolio runs for "u-1" in PAPER with account_id "acct-a"
    Then the result covers all 501 "acct-a" positions and none of the "acct-b" positions

  @AC-4 @FR-6 @regression
  Scenario: Draining past 500 positions keeps quote enrichment batched
    Given user "u-1" holds 501 unpriced positions in PAPER
    When GetPortfolio runs for "u-1" in PAPER
    Then no per-position GetLatestQuote call is made
    And at most 2 GetLatestQuotes batch calls are made

  @AC-5 @FR-5 @regression
  Scenario: A page error in the background readers produces no partial snapshot or risk alert
    Given user "u-1" holds 501 positions in PAPER, one of the 501 is a 30% concentration, and the repository read of the second page fails
    When broadcastSnapshot and checkRiskLimits run for "u-1" in PAPER
    Then no snapshot is persisted or broadcast for "u-1"
    And no concentration alert is emitted for "u-1"
    And each reader logs the page-read failure
