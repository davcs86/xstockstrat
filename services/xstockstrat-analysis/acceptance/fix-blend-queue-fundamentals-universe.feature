# Promoted from docs/roadmap/features/193-fix-blend-queue-fundamentals-universe/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-193` tag.
# Durable business rules xstockstrat-analysis guarantees for the fundamentals-blend universe on the
# opportunity queue and the boot entry-time backfill (the surfaces feature 168's loop-only suite did
# not cover) — the blend is attributed only inside the fundamentals universe, never to platform-signal,
# held, or watchlist symbols outside it.

Feature: fix-blend-queue-fundamentals-universe
  The fundamentals-blend force-run must be attributed on the opportunity queue and the boot
  entry-backfill ONLY within the fundamentals universe — the same set the live loop evaluates —
  and never to a platform signal, held position, or watchlist symbol outside it.

  @AC-1 @regression @feature-193
  Scenario: the queue attributes the blend only inside the fundamentals universe
    Given the fundamentals-blend strategy is live and its kill-switch is on
    And symbol AAPL is in the fundamentals universe (a fundamentals-source signal AND fundamentals data)
    And symbol COIN has only a Form-4 platform signal and NVDA is only a held position
    When the opportunity queue is computed for the user
    Then the blend strategy is attributed to AAPL
    And the blend strategy is attributed to neither COIN nor NVDA

  @AC-2 @regression @feature-193
  Scenario: signal_eligible is inert for the blend on the queue
    Given the fundamentals-blend strategy has signal_eligible = true
    And the platform-wide active-signal pool contains a symbol with no fundamentals data
    When the opportunity queue is computed
    Then that symbol does not receive a blend attribution
    # signal_eligible must not hand the blend the cross-user signal pool on the queue (loop parity).

  @AC-3 @regression @feature-193
  Scenario: the boot entry-backfill anchors the blend only inside the fundamentals universe
    Given the fundamentals-blend strategy is live with a held position outside the fundamentals universe
    When the boot entry-time backfill runs
    Then it infers an entry anchor only for the blend's fundamentals-universe symbols
    And it never issues a ListOrders backfill for a blend pair outside that universe
