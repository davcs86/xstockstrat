Feature: fix-blend-queue-fundamentals-universe (bug fix)
  Regression guard for the defect at
  docs/reports/2026-09-18-opportunity-queue-ignores-fundamentals-universe-defect.md:
  the fundamentals-blend force-run (feature 168) must be attributed on the opportunity queue and the
  boot entry-backfill ONLY within the fundamentals universe — the same set the live loop evaluates —
  and never to a platform signal, held position, or watchlist symbol outside it. This binds the
  queue surface, which feature 168's own acceptance net (loop-only) never covered (C-15/C-16).

  @AC-1 @regression
  Scenario: the queue attributes the blend only inside the fundamentals universe
    Given the fundamentals-blend strategy is live and its kill-switch is on
    And symbol AAPL is in the fundamentals universe (a fundamentals-source signal AND fundamentals data)
    And symbol COIN has only a Form-4 platform signal and NVDA is only a held position
    When the opportunity queue is computed for the user
    Then the blend strategy is attributed to AAPL
    And the blend strategy is attributed to neither COIN nor NVDA

  @AC-2 @regression
  Scenario: signal_eligible is inert for the blend on the queue
    Given the fundamentals-blend strategy has signal_eligible = true
    And the platform-wide active-signal pool contains a symbol with no fundamentals data
    When the opportunity queue is computed
    Then that symbol does not receive a blend attribution
    # signal_eligible must not hand the blend the cross-user signal pool on the queue (loop parity).

  @AC-3 @regression
  Scenario: the boot entry-backfill anchors the blend only inside the fundamentals universe
    Given the fundamentals-blend strategy is live with a held position outside the fundamentals universe
    When the boot entry-time backfill runs
    Then it infers an entry anchor only for the blend's fundamentals-universe symbols
    And it never issues a ListOrders backfill for a blend pair outside that universe
