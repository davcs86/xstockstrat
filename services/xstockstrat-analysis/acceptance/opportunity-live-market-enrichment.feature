# Promoted from docs/roadmap/features/095-opportunity-live-market-enrichment/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-095`
# tag. Durable business rules xstockstrat-analysis already guarantees — a rule enters only by
# promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: opportunity-live-market-enrichment
  What xstockstrat-analysis guarantees for opportunity ranking when a live-quote enrichment is folded
  in: the live quote is presentation-only and must never enter the ranking hot path (no look-ahead).

  @AC-14 @FR-8 @feature-095
  Scenario: Folding in the live quote does not leak look-ahead into ranking
    Given a fixed backtest/ranking input for "CAPR"
    When conviction and readiness ranking are computed with the live-quote enrichment attached and again with it absent
    Then the conviction score and readiness ranking are identical in both cases, proving the live quote does not enter the ranking hot path
