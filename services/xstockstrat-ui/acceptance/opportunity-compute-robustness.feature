# Promoted from docs/roadmap/features/185-opportunity-compute-robustness/acceptance.feature at
# code-completion (Constitution C-16). Source-feature provenance on every scenario's `@feature-185` tag.
# Durable business rule xstockstrat-ui guarantees for the /insights/opportunities Decide queue: a row
# carrying the data-unavailable sentinel renders an explicit "unavailable" cue via the shared C-17
# primitives, never as a misleadingly-quiet 0/0 verdict. (The analysis compute/recovery guarantees and
# the agent list_opportunities projection are promoted to their own service suites.)

Feature: opportunity-compute-robustness (ui-service guarantees)
  As a trader on the Decide queue, I want a data-unavailable symbol shown as an explicit "unavailable"
  state — not a quiet 0/0 row — so I can tell "we couldn't evaluate this" apart from "evaluated, nothing
  fired".

  @AC-3 @FR-2 @feature-185
  Scenario: The Decide queue renders the unavailable state explicitly
    Given ListOpportunities returns a row with the data-unavailable sentinel
    When the /insights/opportunities queue renders that row
    Then the row shows an explicit "unavailable" cue via the shared C-17 primitives
    And it is not rendered as a "quiet" 0/0 verdict
