# Promoted from docs/roadmap/features/199-opportunity-composite-score/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance on every scenario's `@feature-199` tag.
# Durable business rules xstockstrat-analysis guarantees for the per-opportunity composite_score:
# persisted alongside (never replacing) conviction/signal_axis, fused by breadth-aware shrinkage over
# the two present axes (readiness, directional signal), absent axis = zero weight, present-contradicted
# signal = active pull-down, deterministic within a compute pass, and NULL (not a misleading value)
# when never computed, data-unavailable, or a muted 0/0 placeholder. (AC-8 is the /insights render ->
# promoted to the ui suite; AC-9 is the list_opportunities MCP projection -> promoted to the agent suite.)

Feature: opportunity-composite-score (analysis-service guarantees)
  What xstockstrat-analysis guarantees for the opportunity composite score: a single 0-1 value per
  opportunity row fusing readiness and directional-signal evidence, persisted on the refresh write path
  alongside the existing axes.

  @AC-1 @FR-1 @feature-199
  Scenario: Composite is persisted alongside the existing axes, not replacing them
    Given an opportunity row for user "u1", symbol "AAPL", strategy "s1" with conviction 0.80 and signal_axis 0.60
    When the opportunity-refresh write path computes and persists the row
    Then the row on analysis.opportunities carries a composite_score column in [0.0, 1.0]
    And the conviction column still reads 0.80 and the signal_axis column still reads 0.60 (both independently queryable)

  @AC-2 @FR-2 @feature-199
  Scenario: Breadth-aware shrinkage blends the two present axes toward the neutral prior
    Given k = 1.0, prior = 0.5, and two evidence sub-scores each present with weight 1.0: readiness 0.90, signal 0.70
    When the composite is computed
    Then composite = (1.0*0.90 + 1.0*0.70 + 0.5*1.0) / (1.0 + 1.0 + 1.0)
    And composite equals 0.700 (3-decimal)

  @AC-3 @FR-3 @feature-199
  Scenario: An absent axis contributes zero weight and shrinks toward neutral, never toward zero
    Given readiness present at 0.80 weight 1.0, and no active signal for the symbol, with k = 1.0 prior = 0.5
    When the composite is computed
    Then the signal axis contributes w=0 (it is omitted, not inserted as s=0.0)
    And composite = (1.0*0.80 + 0.5*1.0) / (1.0 + 1.0) = 0.650 (3-decimal)
    And composite is strictly greater than 0.0

  @AC-4 @FR-3 @FR-4 @feature-199
  Scenario: Present-but-contradicted signal is an active pull-down, distinct from an absent signal
    Given readiness present at 0.80 weight 1.0, and a signal axis that IS present (signals exist) but fully contradicted so its sub-score is 0.0
    And k = 1.0, prior = 0.5
    When the composite is computed
    Then the signal axis contributes w=1.0 with s=0.0 (present evidence, an active pull-down — NOT dropped as absent)
    And composite = (1.0*0.80 + 1.0*0.0 + 0.5*1.0) / (1.0 + 1.0 + 1.0) = 0.433 (3-decimal)
    And this is strictly less than the 0.650 an otherwise-identical row with NO signal evidence would score (present-contradicted ranks below missing)

  @AC-5 @FR-4 @feature-199
  Scenario: Direction — an agreeing second signal outranks a contradicting one (multiplicative attenuation)
    Given two "buy"-direction opportunities A and B, each with readiness 0.80 and a primary buy signal of effective conviction 0.70 (setting best_direction "buy"), k = 1.0
    And opportunity A's second signal is "buy" at effective conviction 0.50 (agrees, so max_conflict = 0)
    And opportunity B's second signal is "sell" at effective conviction 0.50 (conflicts, so max_conflict = 0.50)
    When both composites are computed with identical config
    Then A's signal sub-score = 0.70 * (1 - 0.0) = 0.70, giving composite = (0.80 + 0.70 + 0.5)/3 = 0.667 (3-decimal)
    And B's signal sub-score = 0.70 * (1 - 0.50) = 0.35, giving composite = (0.80 + 0.35 + 0.5)/3 = 0.550 (3-decimal)
    And opportunity A's composite (0.667) is strictly greater than opportunity B's composite (0.550)

  @AC-6 @FR-5 @feature-199
  Scenario: Both axes feed the fusion, each weighted by its own configured weight
    Given k = 1.0, prior = 0.5, and two sub-scores with distinct weights: readiness 0.90 weight 2.0, signal 0.70 weight 1.0
    When the composite is computed
    Then composite = (2.0*0.90 + 1.0*0.70 + 0.5*1.0) / (2.0 + 1.0 + 1.0)
    And composite equals 0.750 (3-decimal), proving the readiness weight of 2.0 is applied and not collapsed to 1.0 (weight 1.0 would yield 0.700)
    And each sub-score used is in [0.0, 1.0]

  @AC-7 @FR-6 @feature-199
  Scenario: The composite is deterministic across recomputation within one pass
    Given a fixed opportunity input set and fixed config values at a fixed compute-pass timestamp
    When the composite is computed twice on the refresh path
    Then both computations yield the identical composite_score value
    And the value is identical whether or not read-time live-quote enrichment is applied (no look-ahead into the score)

  @AC-10 @FR-1 @FR-3 @feature-199
  Scenario: A never-yet-computed opportunity reports no composite rather than a misleading value
    Given a freshly materialized opportunity row whose composite has not yet been computed
    When the row is read back
    Then composite_score is NULL (the "not yet computed" state), distinct from a computed neutral 0.500

  @AC-11 @FR-3 @feature-199
  Scenario: A data-unavailable row persists NULL composite, never a signal-only value
    Given an opportunity whose bars/indicator fetch fails during the refresh compute (the "unavailable" sentinel is stamped and both ranking axes are zeroed)
    When the row is computed and persisted
    Then both axes are forced absent so Sigma-w = 0 and composite_score is NULL (computed against the real readiness/signal, before the axis-zeroing — never a computed 0.167 or a signal-only value)
    And the /insights row and the list_opportunities response render the composite as an em-dash, never 0.000

  @AC-12 @FR-3 @feature-199
  Scenario: A muted non-held 0/0 placeholder persists NULL composite
    Given a muted (deny-listed) non-held (symbol, strategy) placeholder that is a 0/0 UNSPECIFIED candidate — not evaluated (total_conditions = 0) and with no active signal
    When the row is computed and persisted
    Then readiness is absent and signal is absent, so Sigma-w = 0 and composite_score is NULL
    And the composite renders as an em-dash, distinct from a computed neutral 0.500
