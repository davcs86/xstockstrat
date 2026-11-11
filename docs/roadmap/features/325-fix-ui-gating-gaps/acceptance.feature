Feature: fix-ui-gating-gaps (bug fix)
  Regression guard for two xstockstrat-ui defect reports (namespace editor admin gate, watchlist in-queue flag).

  # guards: docs/reports/2026-10-19-ui-namespace-editor-non-admin-edit-defect.md
  @AC-1 @regression
  Scenario: A non-admin sees no working Edit affordance in the config-ui namespace editor
    Given a logged-in viewer user without admin scope
    When they open /config-ui/<namespace> and a row's Actions menu
    Then no Edit action is offered, or an "Admin only" notice is shown as on config-ui/sources
    And they never reach a "Save error: Admin scope required" message

  # guards: docs/reports/2026-10-19-ui-watchlist-inqueue-first-page-only-defect.md
  @AC-2 @regression
  Scenario: A watchlisted symbol ranked below the first opportunity page shows as in queue
    Given a user's opportunity queue holds more than 50 rows
    And a watchlist contains a symbol whose opportunity ranks below row 50
    When the user opens that watchlist's detail
    Then WatchlistReadiness marks that symbol as in queue
