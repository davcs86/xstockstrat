# Promoted from docs/roadmap/features/206-fix-reconciliation-false-halt/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-206` tag.
# Durable business rules xstockstrat-portfolio already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. This covers the
# account.positions.synced empty-broker-snapshot delete guard.

Feature: xstockstrat-portfolio — an empty broker position snapshot never purges order-fill-derived positions
  Regression guard for the reconciliation false-halt recorded in
  docs/reports/2026-09-25-reconciliation-false-halt-defect.md (pruned 2026-10-05; git show 2ce8de0a:docs/reports/<file>).

  @AC-4 @regression @feature-206
  Scenario: An empty broker position snapshot does not delete order-fill-derived positions
    Given a portfolio position for an account seeded from an order fill
    When an account.positions.synced broker snapshot with an empty positions list is consumed
    Then the existing order-fill-derived position is not deleted
