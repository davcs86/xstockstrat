# Promoted from docs/roadmap/features/215-block-fundamentals-strategy-on-etf/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-215` tag.
# Durable business rules xstockstrat-ui already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: @AC-15 e2e/trader/position-detail.spec.ts (SCHD is absent from the queue fixture, so the
# badge can only come from the symbol-filtered ListOpportunities request the test waits for).

Feature: xstockstrat-ui — block fundamentals-gated strategies on symbols without fundamentals (ETFs)
  A strategy that requires fundamentals is refused, denied entry, or skipped with an explicit,
  auditable reason on a symbol with no usable fundamentals (an ETF such as SCHD), never a silent
  no-trade that reads like a genuine no-signal.

  @AC-15 @FR-3 @feature-215
  Scenario: Signal-detail shows the fundamentals-unavailable state regardless of queue rank
    Given the user's queue has more than 50 rows and the "SCHD" fundamentals-unavailable row ranks below row 50
    When the user opens /trader/positions/SCHD with strategy "fundamentals_macd_blend" selected
    Then the fundamentals-unavailable badge and the SignalReadiness notice are shown
