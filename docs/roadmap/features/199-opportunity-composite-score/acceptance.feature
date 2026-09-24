Feature: opportunity-composite-score
  As a trader, I want each opportunity to carry a single consolidated 0-1 composite score
  that fuses its readiness and directional-signal evidence, so that I can rank and compare
  opportunities at a glance without manually combining separate axes.

  # Scope: v1 fuses exactly two axes present at the opportunity write path — readiness
  # (conviction) and directional signal. Fundamentals/technical were removed from FR-5 by
  # user sign-off (2026-09-20, context.md); recon proved they are not distinct axes here.

  @AC-1 @FR-1
  Scenario: Composite is persisted alongside the existing axes, not replacing them
    Given an opportunity row for user "u1", symbol "AAPL", strategy "s1" with conviction 0.80 and signal_axis 0.60
    When the opportunity-refresh write path computes and persists the row
    Then the row on analysis.opportunities carries a composite_score column in [0.0, 1.0]
    And the conviction column still reads 0.80 and the signal_axis column still reads 0.60 (both independently queryable)

  @AC-2 @FR-2
  Scenario: Breadth-aware shrinkage blends the two present axes toward the neutral prior
    Given k = 1.0, prior = 0.5, and two evidence sub-scores each present with weight 1.0: readiness 0.90, signal 0.70
    When the composite is computed
    Then composite = (1.0*0.90 + 1.0*0.70 + 0.5*1.0) / (1.0 + 1.0 + 1.0)
    And composite equals 0.700 (3-decimal)

  @AC-3 @FR-3
  Scenario: An absent axis contributes zero weight and shrinks toward neutral, never toward zero
    Given readiness present at 0.80 weight 1.0, and no active signal for the symbol, with k = 1.0 prior = 0.5
    When the composite is computed
    Then the signal axis contributes w=0 (it is omitted, not inserted as s=0.0)
    And composite = (1.0*0.80 + 0.5*1.0) / (1.0 + 1.0) = 0.650 (3-decimal)
    And composite is strictly greater than 0.0

  @AC-4 @FR-3 @FR-4
  Scenario: Present-but-contradicted signal is an active pull-down, distinct from an absent signal
    Given readiness present at 0.80 weight 1.0, and a signal axis that IS present (signals exist) but fully contradicted so its sub-score is 0.0
    And k = 1.0, prior = 0.5
    When the composite is computed
    Then the signal axis contributes w=1.0 with s=0.0 (present evidence, an active pull-down — NOT dropped as absent)
    And composite = (1.0*0.80 + 1.0*0.0 + 0.5*1.0) / (1.0 + 1.0 + 1.0) = 0.433 (3-decimal)
    And this is strictly less than the 0.650 an otherwise-identical row with NO signal evidence would score (present-contradicted ranks below missing)

  @AC-5 @FR-4
  Scenario: Direction — an agreeing second signal outranks a contradicting one (multiplicative attenuation)
    Given two "buy"-direction opportunities A and B, each with readiness 0.80 and a primary buy signal of effective conviction 0.70 (setting best_direction "buy"), k = 1.0
    And opportunity A's second signal is "buy" at effective conviction 0.50 (agrees, so max_conflict = 0)
    And opportunity B's second signal is "sell" at effective conviction 0.50 (conflicts, so max_conflict = 0.50)
    When both composites are computed with identical config
    Then A's signal sub-score = 0.70 * (1 - 0.0) = 0.70, giving composite = (0.80 + 0.70 + 0.5)/3 = 0.667 (3-decimal)
    And B's signal sub-score = 0.70 * (1 - 0.50) = 0.35, giving composite = (0.80 + 0.35 + 0.5)/3 = 0.550 (3-decimal)
    And opportunity A's composite (0.667) is strictly greater than opportunity B's composite (0.550)

  @AC-6 @FR-5
  Scenario: Both axes feed the fusion, each weighted by its own configured weight
    Given k = 1.0, prior = 0.5, and two sub-scores with distinct weights: readiness 0.90 weight 2.0, signal 0.70 weight 1.0
    When the composite is computed
    Then composite = (2.0*0.90 + 1.0*0.70 + 0.5*1.0) / (2.0 + 1.0 + 1.0)
    And composite equals 0.750 (3-decimal), proving the readiness weight of 2.0 is applied and not collapsed to 1.0 (weight 1.0 would yield 0.700)
    And each sub-score used is in [0.0, 1.0]

  @AC-7 @FR-6
  Scenario: The composite is deterministic across recomputation within one pass
    Given a fixed opportunity input set and fixed config values at a fixed compute-pass timestamp
    When the composite is computed twice on the refresh path
    Then both computations yield the identical composite_score value
    And the value is identical whether or not read-time live-quote enrichment is applied (no look-ahead into the score)

  @AC-8 @FR-7
  Scenario: The composite is exposed on the opportunities queue as a 3-decimal scalar
    Given an opportunity with a persisted composite_score of 0.732
    When a trader opens the /insights opportunities queue
    Then the opportunity row displays "0.732" colored via the existing scoreColor scale
    And no A-F letter grade is shown for the composite
    And the client does not re-sort the queue by the composite (server order is authoritative)

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

  @AC-11 @FR-3
  Scenario: A data-unavailable row persists NULL composite, never a signal-only value
    Given an opportunity whose bars/indicator fetch fails during the refresh compute (the "unavailable" sentinel is stamped and both ranking axes are zeroed)
    When the row is computed and persisted
    Then both axes are forced absent so Sigma-w = 0 and composite_score is NULL (computed against the real readiness/signal, before the axis-zeroing — never a computed 0.167 or a signal-only value)
    And the /insights row and the list_opportunities response render the composite as an em-dash, never 0.000

  @AC-12 @FR-3
  Scenario: A muted non-held 0/0 placeholder persists NULL composite
    Given a muted (deny-listed) non-held (symbol, strategy) placeholder that is a 0/0 UNSPECIFIED candidate — not evaluated (total_conditions = 0) and with no active signal
    When the row is computed and persisted
    Then readiness is absent and signal is absent, so Sigma-w = 0 and composite_score is NULL
    And the composite renders as an em-dash, distinct from a computed neutral 0.500
