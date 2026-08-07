# Context: wire-signal-confidence-to-position-sizing

**Feature**: `docs/roadmap/features/110-wire-signal-confidence-to-position-sizing/feature.md`
**Product Spec**: `docs/roadmap/features/110-wire-signal-confidence-to-position-sizing/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/110-wire-signal-confidence-to-position-sizing/implementation-spec.md`

---

## Session 2026-08-05T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md.
- This is a **named C-14 follow-up** from `023-position-sizing-engine`'s design debate (round 5):
  023's design added `PlaceOrderRequest.confidence` but the user explicitly decided to drop all UI
  wiring from 023's own scope (round-5 gate decision: "Drop UI wiring this round, ship backend-only")
  after the design-adversary found (a) `/insights` was an unnamed C-14 surface, (b) `Opportunity.conviction`
  is documented as "NOT a probability" — a semantic mismatch with what `confidence` needs — and
  (c) a global blank-qty UI change would silently max-risk-auto-size orders on the plain `/trader` form.
  This feature exists specifically so that deferral is a **named follow-up**, not a vague "later" (the
  only C-14-compliant form of deferral).
- Hard dependency: `023-position-sizing-engine` must reach at least `design-approved` (its `confidence`
  field must exist) before this feature's `/sdd-design` can proceed meaningfully — recorded as an
  Open Question in product-spec.md, not yet a formal `merge-order.md` entry (added once this feature
  reaches `spec-ready`/`implementation-ready`).
