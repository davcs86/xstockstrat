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

  # Promoted from docs/roadmap/features/289-fix-analysis-admin-formula-refusal/acceptance.feature
  # (Constitution C-16). Every @feature-289 scenario below assumes that feature's Background:
  #   Given admin user "admin-1" (x-access-scope admin) owns live strategies "s-1" and "s-2", both bound to symbol "MYSZ" (and "s-2" also to symbol "AAPL")
  #   And a component formula "f-9" of "s-1" is authored by user "user-2", while all components of "s-2" are readable by "admin-1"
  #   And the entry rule of "s-1" references "f-9"
  # "the unreadable-formula marker" is the bool formula_unreadable (Opportunity field 25, SymbolReadiness field 6; provenance token and readiness_json key "formula_unreadable").
  # @AC-7 Examples rows for the other surfaces: watchlist-readiness-list-ux.feature, watchlist-opportunity-signal-cues.feature.

  @AC-7 @FR-2 @FR-3 @feature-289
  Scenario Outline: The UI shows a distinct state for an unreadable formula on every consuming surface
    Given <source> shows the "s-1" entry for "MYSZ" with the unreadable-formula marker
    When "admin-1" opens <surface>
    Then "MYSZ" is shown in the "formula not readable" state, not the data-unavailable state and not a quiet 0 of N row

    Examples:
      | surface                                          | source                                                   |
      | /insights/opportunities                          | the ListOpportunities row                                |
      | the mobile opportunity section                   | the ListOpportunities row                                |

  @AC-27 @FR-2 @FR-3 @feature-289
  Scenario: A held unreadable row shows its action badge plus the cue
    Given the "s-1" row for "MYSZ" is held, carries the unreadable-formula marker and has action REDUCE
    When "admin-1" opens /insights/opportunities
    Then "MYSZ" shows the REDUCE badge and the "formula not readable" cue, not the data-unavailable state
