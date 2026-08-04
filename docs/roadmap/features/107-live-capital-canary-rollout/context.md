# Context: live-capital-canary-rollout

**Feature**: `docs/roadmap/features/107-live-capital-canary-rollout/feature.md`
**Product Spec**: `docs/roadmap/features/107-live-capital-canary-rollout/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/107-live-capital-canary-rollout/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 10 ("live-trading canary mode").
- Hard-depends on all other P0 controls (100 kill switch, 101 idempotency, 102 reconciliation, 030
  stop-loss/bracket orders, 023 position sizing) — its promotion criteria (FR-3) are evidence that
  those controls are clean over an observation window. Per the source review this is correctly last
  among the P0 items ("All P0 controls").

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted)

- Feasibility re-check found this feature's entire premise — staging a live rollout across
  "shadow → paper → single-symbol → single-strategy → ..." — is a rollout plan **for automated
  strategy execution**. That capability does not exist in this codebase: `048-live-strategy-alert-
  engine` is explicitly alert-only (its own product spec: "...so that I can act on... without manually
  re-running anything" — a human still acts), and no code path calls `PlaceOrder` outside the
  human-driven trader UI. Building a canary-rollout mechanism for a capability that isn't built and
  isn't currently roadmapped is building a control before there is anything to control.
- Demoted to `demoted/canceled`. This is the correct feature to write **when and if** an automated
  strategy-to-order execution feature is proposed and approved — at that point its premise (never
  jump straight from paper to unrestricted live automated trading) is sound and should be revived
  nearly as-specced.
