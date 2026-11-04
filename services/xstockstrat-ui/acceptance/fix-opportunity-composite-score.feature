# Promoted from docs/roadmap/features/221-fix-opportunity-composite-score/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance on every scenario's `@feature-221` tag.
# Durable business rule xstockstrat-ui guarantees: the opportunity composite_score is coloured by
# direction from its 0.5 neutral point (not by strategy-grade thresholds); strategy-grade colouring
# is unchanged. Supersedes the "colored via the existing scoreColor scale" clause of feature 199 @AC-8
# (services/xstockstrat-ui/acceptance/opportunity-composite-score.feature).

Feature: fix-opportunity-composite-score (ui-service guarantees)
  Regression guard for defect report docs/reports/2026-10-06-ui-composite-score-grade-colour-defect.md:
  Opportunity composite score is coloured with strategy-grade thresholds, so neutral reads as bearish.

  @AC-1 @regression @feature-221
  Scenario: A neutral composite renders muted, not as a bearish colour
    Given an opportunity with a persisted composite_score of 0.500
    When a trader views it on the /insights opportunities queue or the trader position page
    Then the composite displays "0.500" in the muted neutral style
    And it is not rendered with the destructive (bearish) colour

  @AC-2 @regression @feature-221
  Scenario: Composite tails are coloured by direction from the neutral point
    Given opportunities with persisted composite_scores of 0.720 and 0.300
    When a trader views them on the /insights opportunities queue
    Then the 0.720 composite is rendered with the positive colour
    And the 0.300 composite is rendered with the negative colour

  @AC-3 @regression @feature-221
  Scenario: Strategy-grade colouring is unchanged
    Given a strategy overall score of 0.650
    When a trader views it on the strategies page
    Then it is still rendered with the existing grade colour for 0.650
