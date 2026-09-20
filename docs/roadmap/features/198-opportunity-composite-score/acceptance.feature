Feature: opportunity-composite-score
  As a trader, I want each opportunity to carry a single consolidated 0-1 composite score
  that fuses its readiness, signal strength, fundamentals, and technical evidence, so that
  I can rank and compare opportunities at a glance without manually combining separate axes.

  @AC-1 @FR-1
  Scenario: Composite is persisted alongside the existing axes, not replacing them
    Given an opportunity row for user "u1", symbol "AAPL", strategy "s1" with conviction 0.80 and signal_axis 0.60
    When the opportunity-refresh write path computes and persists the row
    Then the row on analysis.opportunities carries a composite_score column in [0.0, 1.0]
    And the conviction column still reads 0.80 and the signal_axis column still reads 0.60 (both independently queryable)

  @AC-2 @FR-2
  Scenario: Breadth-aware shrinkage blends present evidence toward the value-weighted mean
    Given k = 4.0, prior = 0.5, and four evidence sub-scores each present with weight 1.0: readiness 0.90, signal 0.70, fundamentals 0.60, technical 0.80
    When the composite is computed
    Then composite = (1.0*0.90 + 1.0*0.70 + 1.0*0.60 + 1.0*0.80 + 4.0*0.5) / (1.0+1.0+1.0+1.0 + 4.0)
    And composite equals 0.625 (3-decimal)

  @AC-3 @FR-3
  Scenario: An absent evidence type contributes zero weight and shrinks toward neutral, never toward zero
    Given k = 4.0, prior = 0.5, readiness present at 0.90 weight 1.0, and fundamentals, signal, and technical all absent
    When the composite is computed
    Then the absent types contribute w=0 to both numerator and denominator (they do NOT contribute s=0)
    And composite = (1.0*0.90 + 4.0*0.5) / (1.0 + 4.0) = 0.580 (3-decimal)
    And composite is strictly greater than 0.0

  @AC-4 @FR-3
  Scenario: FMP-gated fundamentals absence does not tank the score
    Given an opportunity whose fundamentals sub-score is unavailable because FMP returned no data for the symbol
    And readiness 0.85, signal 0.75, technical 0.70 are all present with weight 1.0, k = 4.0
    When the composite is computed
    Then the fundamentals term is omitted (w=0), not inserted as 0.0
    And the composite reflects only the three present evidence types shrunk toward 0.5

  @AC-5 @FR-4
  Scenario: Evidence agreeing with the declared direction raises magnitude above conflicting evidence
    Given two "buy"-direction opportunities identical except for their technical evidence
    And opportunity A's technical signal agrees with the buy direction while opportunity B's technical signal contradicts it
    When both composites are computed with identical config
    Then opportunity A's composite is strictly greater than opportunity B's composite

  @AC-6 @FR-5
  Scenario: All four evidence types feed the v1 fusion when present
    Given an opportunity with readiness, signal_axis, a fundamentals_value_quality composite output, and a technical signal all available
    When the composite is computed
    Then all four normalized sub-scores appear in the numerator with their configured weights
    And each sub-score used is in [0.0, 1.0]

  @AC-7 @FR-6
  Scenario: The composite is deterministic across recomputation
    Given a fixed opportunity input set and fixed config values
    When the composite is computed twice on the refresh path
    Then both computations yield the identical composite_score value

  @AC-8 @FR-7
  Scenario: The composite is exposed on the opportunities queue as a 3-decimal scalar
    Given an opportunity with a persisted composite_score of 0.732
    When a trader opens the /insights opportunities queue
    Then the opportunity row displays "0.732" colored via the existing scoreColor scale
    And no A-F letter grade is shown for the composite

  @AC-9 @FR-7
  Scenario: The composite reaches the list_opportunities MCP tool response
    Given an opportunity with a persisted composite_score of 0.512
    When the list_opportunities MCP tool returns that opportunity
    Then the returned opportunity object includes the composite score field valued 0.512

  @AC-10 @FR-1 @FR-3
  Scenario: A never-yet-computed opportunity reports no composite rather than a misleading value
    Given a freshly materialized opportunity row whose composite has not yet been computed
    When the row is read back
    Then composite_score is NULL (the "not yet computed" state), distinct from a computed neutral 0.500
