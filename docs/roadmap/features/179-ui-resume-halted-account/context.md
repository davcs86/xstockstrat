# Context: ui-resume-halted-account

**Feature**: `docs/roadmap/features/179-ui-resume-halted-account/feature.md`
**Product Spec**: `docs/roadmap/features/179-ui-resume-halted-account/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/179-ui-resume-halted-account/implementation-spec.md`

---

## Session 2026-09-04 — sdd-story

- Created from performance-audit Track D (`docs/reports/2026-09-04-performance-bottlenecks-audit.md`
  § 4). The audit corrected the original premise: the ResumeAccount RPC, agent trigger, agent
  indicator, and a positions-page halt indicator already exist (features 169/102). The residual gap
  is UI-only — no browser Resume trigger, and no halt indicator beside the account-management
  controls. This is exactly what feature 169's product-spec deferred (`:37,:52`).
- Predominantly a UI/BFF feature (no proto/schema/config change), so lower backend risk than
  176/177/178.
- Open scope question folded in: RPC enforces admin-only (`RequireAdminScope`) vs. feature 169 FR-5's
  operator-or-admin — must be reconciled in `/sdd-design`, not silently chosen. Security-role review
  flagged because the control reaches a broker account.
- Known trap folded in: C-10 nav/surface reachability (fails.md:71) — ensure the indicator/control
  land on the rendered account-management surface, not an orphan component.

## Session 2026-09-04 — sdd-review product-spec

- FIRST PASS: FAIL. Blocker: criterion 9 — four unresolved Open Questions, chiefly the admin-vs-operator scope contradiction (ResumeAccount is code-confirmed admin-only, RequireAdminScope at trading.go:2749; feature 169 FR-5 intended operator-or-admin).
- RESOLUTION (recorded decisions): (1) SCOPE — conservative: this UI feature matches the RPC's current admin-only enforcement (FR-5), does NOT modify the RPC; widening ResumeAccount to operator-or-admin is a separate xstockstrat-trading authz change, Out of Scope, FLAGGED FOR OPERATOR OVERRIDE. (2) confirm-UX — yes, folded into FR-3 + AC-6 (surfaces halt_reason). (3) action-site duplication — Resume control solely on account-mgmt surface; positions page stays indicator-only. (4) nav-reachability — deferred to /sdd-design recon (verify AccountsModule/AccountSelector/accountShared is the rendered surface). Added C-2 broker-agnostic note to FR-2; rephrased AC-1/AC-5.
- RE-REVIEW: PASS (no blockers, no warnings). Status: draft → spec-ready.
- OPEN DECISION carried to design + surfaced to operator: whether to keep admin-only (this feature's scope) or widen the RPC per 169's original intent. Design/recon must carry the override flag forward.
- Overlap: CLEAN.
