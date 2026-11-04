Feature: fix-ctx-cancel-warn-flood (bug fix)
  Regression guard for defect report 2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect: portfolio (and marketdata) keep working and WARN-flooding after the context is canceled.

  @AC-1 @regression
  Scenario: A canceled context stops the position-sync loop after one error
    Given a position-sync event with several positions is being processed
    And the handler context is canceled after the first upsert
    When ConsumePositionSyncs processes the event
    Then the handler returns the cancellation once without issuing further repository calls
    And no per-symbol WARN lines are logged for the remaining positions or the delete step
