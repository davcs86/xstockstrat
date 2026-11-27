# Promoted from docs/roadmap/features/314-fix-mcp-deadline-budget/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-314` tag.
# Durable business rules xstockstrat-config already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# Backed by: @AC-3 src/__tests__/setConfigScalarBounds.test.ts (@AC-3: rejects a batch timeout that inverts the stored portfolio quote deadline).

Feature: xstockstrat-config — SetConfig rejects cross-hop deadline inversions
  SetConfig must not accept timeout values that invert cross-hop deadline ordering.

  # guards: docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md
  @AC-3 @regression @feature-314
  Scenario: SetConfig rejects a value that inverts portfolio-over-marketdata quote deadline ordering
    Given portfolio.marketdata.quote_timeout_ms is 1000
    When SetConfig writes marketdata.quotes.batch_timeout_ms = 5000
    Then the write is rejected with INVALID_ARGUMENT
    And the stored marketdata.quotes.batch_timeout_ms is unchanged
