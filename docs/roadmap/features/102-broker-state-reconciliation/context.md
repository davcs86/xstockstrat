# Context: broker-state-reconciliation

**Feature**: `docs/roadmap/features/102-broker-state-reconciliation/feature.md`
**Product Spec**: `docs/roadmap/features/102-broker-state-reconciliation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/102-broker-state-reconciliation/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P0 item 5 ("broker-versus-platform reconciliation").
- Depends on 101 (exactly-once-order-intent) for the `UNKNOWN`-state contract it reconciles against.
  Feeds 100 (account-trading-halt-and-kill-switch) as an automatic halt trigger on unsafe mismatches,
  and 108 (trading-safety-dashboard-slos) as a status/age metric source.
