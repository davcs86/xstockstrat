Feature: fix-analysis-held-position-drains (bug fix)
  Regression guard for defect report docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md: analysis held-position drains trust next_page_token and return partial results as success.

  @AC-1 @regression
  Scenario: A drain rejects a next_page_token equal to the one it sent
    Given the portfolio ListPositions fake ignores page_token and always returns position "AAPL" with market_value 100 and next_page_token "t"
    When live_loop._drain_held and servicer._drain_held_symbols drain the owner's held positions
    Then each drain stops after the second call instead of reading 50 pages
    And the drain is reported as failed rather than returning "AAPL" valued at more than 100
    And the held-drain failure is counted

  @AC-2 @regression
  Scenario: A drain that reaches its page cap with a token still pending is not silent
    Given the portfolio ListPositions fake returns a distinct non-empty next_page_token on every page
    When a held-position drain reaches its page cap
    Then a warning is logged naming the owner and the cap
    And the cap hit is counted as a held-drain failure

  @AC-3 @regression
  Scenario: A page error mid-drain is an error, never end-of-data
    Given the portfolio ListPositions fake returns page 1 with a next_page_token and then raises on page 2
    When live_loop._drain_held and servicer._drain_held_symbols drain the owner's held positions
    Then neither drain returns page 1's rows as a completed held set
    And the held-drain failure is counted

  @AC-4
  Scenario: A multi-page drain returns every held position exactly once
    Given the portfolio ListPositions fake honors page_token across three pages holding "AAPL", "MSFT" and "NVDA"
    When servicer._drain_held_symbols drains the owner's held positions
    Then the result holds each of "AAPL", "MSFT" and "NVDA" once with its own abs(market_value)
