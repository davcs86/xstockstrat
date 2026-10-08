# Promoted from docs/roadmap/features/195-fix-strategy-detail-definition-render/acceptance.feature
# Source: @AC-1, @AC-2 — regression guard scenarios
Feature: fix-strategy-detail-definition-render (regression guard)
  Acceptance scenarios for the xstockstrat-ui service promoted from feature 195 (bug fix).
  Guards against regression of the /insights strategy-detail page failing to render the
  strategy's definition (components + entry/exit rules) for any reader, using data
  useGetStrategy already fetches.

  @AC-1 @regression @feature-195
  Scenario: the detail page renders the strategy definition card
    Given a registered strategy with at least one component
    When a reader opens /insights/strategies/<id>
    Then a Definition card is visible
    And it lists the strategy's components (ref name and indicator/formula)
    And it shows the entry rule and the exit rule

  @AC-2 @regression @feature-195
  Scenario: the definition is visible without admin scope
    Given a non-admin reader viewing a strategy detail page
    Then the Definition card is shown
    # Read-only definition info the owner already has via the RPC — only write controls are admin-gated.
