Feature: symbol-opportunity-ranking
  As a trader, I want one comparable symbol-level score that consolidates all of a symbol's
  opportunities, so that I can rank which symbol to trade across the whole opportunity queue
  rather than eyeballing individual opportunities.

  # symbol_score = diminishing-returns sum over the symbol's opportunities of
  # (feature-199 composite_score x strategy_weight), where strategy_weight =
  # feature-065 derived-grade weight x operator per-strategy override.
  # The exact saturating function is a design-phase decision; these scenarios assert the
  # mandated ORDERINGS, which any compliant function must satisfy.

  @AC-1 @FR-1
  Scenario: The symbol score is built from the symbol's per-opportunity composite scores
    Given symbol "AAPL" has two opportunities with feature-199 composite_score 0.70 and 0.60
    When the symbol roll-up is computed
    Then AAPL's symbol_score is a function of those composite_scores (0.70, 0.60), not of raw conviction or signal_axis directly
    And changing an opportunity's composite_score changes AAPL's symbol_score

  @AC-2 @FR-2
  Scenario: Two corroborating moderate opportunities outrank one lone strong opportunity
    Given symbol "AAPL" has 2 opportunities, each at conviction 0.80 with full readiness (all conditions passing)
    And symbol "MSFT" has 1 opportunity at conviction 1.00
    And all four opportunities are from strategies of equal strategy_weight
    When both symbol_scores are computed and the queue is ranked by symbol_score
    Then AAPL ranks strictly above MSFT
    And this is the opposite of the legacy MAX-over-opportunities ordering (which ranked MSFT's 1.00 above AAPL's 0.80)

  @AC-3 @FR-2
  Scenario: Diminishing returns keeps many weak opportunities from overtaking a strong pair
    Given symbol "PENNY" has 6 opportunities each at composite_score 0.30
    And symbol "AAPL" has 2 opportunities each at composite_score 0.80
    And all opportunities are from strategies of equal strategy_weight
    When both symbol_scores are computed
    Then AAPL ranks strictly above PENNY (the sum saturates so breadth of weak evidence does not run away past genuine strength)

  @AC-4 @FR-3
  Scenario: A symbol carrying a higher-weighted strategy outranks one without it
    Given symbol "AAPL" has 2 opportunities each at composite_score 0.70, one from strategy "fundamental_macd_blend" (derived grade A) and one from a grade-C strategy
    And symbol "MSFT" has 2 opportunities each at composite_score 0.70, both from grade-C strategies (neither is fundamental_macd_blend)
    And no operator overrides are set (override weight = 1.0 for all)
    When both symbol_scores are computed
    Then AAPL ranks strictly above MSFT, because fundamental_macd_blend's grade-A weight exceeds grade C

  # @AC-5 is DEFERRED (round-5 design decision, 2026-09-21): the per-strategy operator override is
  # descoped from v1 and moved to a follow-up feature. This scenario is NOT covered by a v1 test step;
  # it carries forward (append-only, never renumbered) to the override follow-up. FR-3's grade-weighting
  # stays covered by @AC-4. See design.md § Deferred.
  @AC-5 @FR-3 @deferred-followup
  Scenario: An operator per-strategy override raises symbols carrying that strategy
    Given symbols "AAPL" and "MSFT" have identical opportunity sets except AAPL has one opportunity from strategy "fundamental_macd_blend" where MSFT's is from a same-grade strategy "foo"
    And AAPL and MSFT are initially tied in symbol_score
    When the operator sets the per-strategy override for "fundamental_macd_blend" to 1.5 (from the default 1.0)
    Then AAPL's symbol_score increases and AAPL ranks strictly above MSFT

  @AC-6 @FR-4
  Scenario: A NULL composite opportunity contributes nothing, it does not drag the symbol down
    Given symbol "AAPL" has one opportunity at composite_score 0.75 and one opportunity whose composite_score is NULL (feature-199 data-unavailable / not-yet-computed)
    When the symbol_score is computed
    Then the NULL opportunity contributes 0 weight to the roll-up (it is omitted, not counted as composite 0.0)
    And AAPL's symbol_score equals what it would be from the single 0.75 opportunity alone
    And a symbol whose every opportunity has a NULL composite has no symbol_score (NULL / omitted), distinct from a computed low score

  @AC-7 @FR-4
  Scenario: An opportunity from a provisionally-graded strategy still contributes at a neutral weight
    Given symbol "AAPL" has one opportunity at composite_score 0.70 from strategy "newstrat" whose feature-065 grade is provisional (below the evidence floor)
    When the symbol_score is computed
    Then "newstrat" is weighted by the defined neutral fallback weight (strictly greater than 0), not 0
    And the opportunity still contributes to AAPL's symbol_score

  @AC-8 @FR-5
  Scenario: The opportunities queue can be ranked by symbol_score, server-authoritative
    Given a set of symbols with computed symbol_scores
    When a trader sorts the /insights opportunities queue by symbol score
    Then the SymbolGroupCard groups render in descending symbol_score order as returned by the server
    And the client does not re-sort the groups locally (server order is authoritative)

  @AC-9 @FR-5
  Scenario: The MCP agent can compare symbols by symbol_score
    Given AAPL has symbol_score 0.62 and MSFT has symbol_score 0.48
    When the agent requests the ranked opportunities
    Then the response exposes each symbol's symbol_score and AAPL is presented above MSFT

  @AC-10 @FR-5
  Scenario: The symbol score is deterministic for a fixed input set
    Given a fixed set of opportunities (fixed composite_scores, strategy grades, and config) at a fixed compute-pass timestamp
    When the symbol_score is computed twice
    Then both computations yield the identical symbol_score for each symbol
