Feature: fix-strategy-detail-definition-render (bug fix)
  Regression guard for the defect at
  docs/reports/2026-09-18-strategy-detail-definition-not-rendered-defect.md:
  the /insights strategy-detail page must render the strategy's definition (components + entry/exit
  rules) for any reader, using data useGetStrategy already fetches.

  @AC-1 @regression
  Scenario: the detail page renders the strategy definition card
    Given a registered strategy with at least one component
    When a reader opens /insights/strategies/<id>
    Then a Definition card is visible
    And it lists the strategy's components (ref name and indicator/formula)
    And it shows the entry rule and the exit rule

  @AC-2 @regression
  Scenario: the definition is visible without admin scope
    Given a non-admin reader viewing a strategy detail page
    Then the Definition card is shown
    # Read-only definition info the owner already has via the RPC — only write controls are admin-gated.
