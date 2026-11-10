# Promoted from docs/roadmap/features/290-fix-ctx-cancel-warn-flood/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-290` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-portfolio — canceled context stops position-sync without WARN flood (bug fix)
  Regression guard for defect report 2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect (pruned 2026-11-10; `git show 2d91b567:docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md`): portfolio keeps working and WARN-flooding after the context is canceled.

  @AC-1 @FR-1 @regression @feature-290
  Scenario: A canceled context stops the position-sync loop after the first upsert
    Given an offline position-sync event for account "acc-1" with 3 positions "AAPL", "MSFT" and "NVDA"
    And the handler context is canceled right after the upsert of "AAPL" succeeds
    When processPositionSync handles the event
    Then exactly 1 repository write was made and no DELETE and no realized-P&L write followed
    And the returned error matches context.Canceled and no WARN is logged

  @AC-2 @FR-1 @regression @feature-290
  Scenario: A write that discovers the cancellation stops the loop without a WARN
    Given an offline position-sync event for account "acc-1" with 3 positions "AAPL", "MSFT" and "NVDA"
    And the first repository write (the upsert of "AAPL") cancels the context and fails with the context error
    When processPositionSync handles the event
    Then exactly 1 write was attempted and no DELETE was issued
    And no WARN is logged and the returned error matches context.Canceled

  @AC-3 @FR-1 @regression @feature-290
  Scenario: A canceled offline sync through the retry wrapper is never parked and the cursor is withheld
    Given an offline position-sync event for account "acc-1" and a context that is already done
    When the event is handled through boundedRetry
    Then the handler returns a non-nil error matching context.Canceled, which withholds the stream cursor
    And no offline_account_realized write is made and no "event parked" Error is logged

  @AC-4 @FR-1 @characterization @feature-290
  Scenario: A genuine write failure with a live context still warns
    Given a broker position-sync event for account "brk-1" with the position "AAPL" qty 10 and a live context
    And the upsert of "AAPL" fails with a driver-reported context.Canceled
    When processPositionSync handles the event
    Then "upsert position from sync failed" for symbol "AAPL" is logged at WARN

  @AC-5 @FR-1 @characterization @feature-290
  Scenario: The empty-broker-snapshot skip path is unchanged by a done context
    Given a broker position-sync event for account "brk-1" with no positions and a context that is already done
    When processPositionSync handles the event
    Then no repository call is made and the handler returns nil

  @AC-10 @FR-1 @regression @feature-290
  Scenario: A canceled broker sync stops without writing and returns the cancellation
    Given a broker position-sync event for account "brk-1" with one position "AAPL" qty 10 and a context that is already done
    When processPositionSync handles the event
    Then the returned error matches context.Canceled and no repository call is made
    And no WARN is logged
