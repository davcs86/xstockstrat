Feature: fix-listpositions-nextpagetoken-skips (bug fix)
  Regression guard for defect report docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md

  @AC-1 @regression
  Scenario: Paginated ListPositions yields every position exactly once
    Given user U holds symbol A in accounts X and Y, and symbols B and C in account X
    When ListPositions is traversed with page_size 1 until next_page_token is empty
    Then the traversal returns exactly the 4 positions, each once, in stable order
