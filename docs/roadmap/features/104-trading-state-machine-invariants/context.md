# Context: trading-state-machine-invariants

**Feature**: `docs/roadmap/features/104-trading-state-machine-invariants/feature.md`
**Product Spec**: `docs/roadmap/features/104-trading-state-machine-invariants/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/104-trading-state-machine-invariants/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 7 ("trading state-machine property tests").
- Depends on 103 (broker-failure-simulator) for its generated event streams, and on a stable order
  lifecycle model (benefits from 100/101 landing first, though not a hard blocker for writing the
  invariant assertions themselves).

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted)

- Feasibility re-check found no property-based/model-based testing library currently used anywhere in
  the Go services (`services/xstockstrat-trading` and siblings) — adopting one is new tooling, not
  just new test code. More importantly, the order lifecycle this would harden against randomized
  duplicate/reorder/crash sequences is entirely human-initiated today (see 102's context.md finding —
  the only `PlaceOrder` caller is the trader UI); there is no autonomous scheduler or agent tool
  driving order flow whose invariants need this depth of proof yet.
- Demoted to `demoted/canceled`, dependent on 103 (also demoted). Revisit if/when automated execution
  exists and the order lifecycle is complex enough (multiple concurrent unattended callers) to warrant
  property-based coverage over hand-written cases.
