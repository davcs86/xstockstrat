# Context: ui-resume-halted-account

**Feature**: `docs/roadmap/features/174-ui-resume-halted-account/feature.md`
**Product Spec**: `docs/roadmap/features/174-ui-resume-halted-account/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/174-ui-resume-halted-account/implementation-spec.md`

---

## Session 2026-09-04 — sdd-story

- Created from performance-audit Track D (`docs/reports/2026-09-04-performance-bottlenecks-audit.md`
  § 4). The audit corrected the original premise: the ResumeAccount RPC, agent trigger, agent
  indicator, and a positions-page halt indicator already exist (features 169/102). The residual gap
  is UI-only — no browser Resume trigger, and no halt indicator beside the account-management
  controls. This is exactly what feature 169's product-spec deferred (`:37,:52`).
- Predominantly a UI/BFF feature (no proto/schema/config change), so lower backend risk than
  171/172/173.
- Open scope question folded in: RPC enforces admin-only (`RequireAdminScope`) vs. feature 169 FR-5's
  operator-or-admin — must be reconciled in `/sdd-design`, not silently chosen. Security-role review
  flagged because the control reaches a broker account.
- Known trap folded in: C-10 nav/surface reachability (fails.md:71) — ensure the indicator/control
  land on the rendered account-management surface, not an orphan component.
