# Promoted from feature 353 (fix-listpositions-nextpagetoken-skips) at integration, C-16. Do not hand-edit; scenarios are verbatim.
Feature: fix-listpositions-nextpagetoken-skips (bug fix)
  Regression guard: a paginated ListPositions traversal returns every position exactly once.

  @AC-1 @regression @feature-353
  Scenario: Paginated ListPositions yields every position exactly once
    Given user U holds symbol A in accounts X and Y, and symbols B and C in account X
    When ListPositions is traversed with page_size 1 until next_page_token is empty
    Then the traversal returns exactly the 4 positions, each once, in stable order
