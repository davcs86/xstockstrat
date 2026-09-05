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

## Session 2026-09-05 — sdd-design quick, ROUND 1 (PAUSED, not approved)

Status unchanged: **spec-ready** (user chose "Hold, run another round"). recon.md written + committed. design.md NOT yet written.

**USER DECISION (locked):** scope = **Admin-only, no RPC change**. Accepted limitation: there is NO `operator` scope in code (rolesToAccessScope grants the admin bit only to the `admin` role; a `trader` never gets it — auth.ts:81-92), so the Resume control is visible/usable ONLY to admin-role users, NOT the "operator/trader" persona the user story names. Widening to operator-or-admin (169 FR-5's original intent) stays OUT OF SCOPE (a separate xstockstrat-trading authz C-16 CHANGE). This resolves the adversary's crux fork (fails.md:66) in favor of admin-only.

- **Proposer (r1):** UI-only; forwardAdmin BFF route (resumeAccount after traderBff.ts:57); halt badge in AccountRow shared badge row (reuse positions-page HALT_SOURCE map + EnumBadge); Resume as admin-gated RowActionsMenu action with confirm surfacing halt_reason; handleResume → BFF → refreshAccounts(); AccountSelector gets a warning-dot OR (no control).
- **Adversary (r1): NEEDS WORK, no Floor breach.** Mechanics affirmed sound (forwardAdmin rejects server-side; React auto-escapes halt_reason; sequential await avoids clear-order race). Fixes to fold into round 2:
  1. **Scope fork → RESOLVED by user = admin-only (above).**
  2. **Defense-in-depth test (@AC-4/169):** add a BFF-level test invoking the resumeAccount route with a NON-admin session asserting PermissionDenied (separate from the hidden-button test) — else a future forwardAdmin→forward refactor silently reopens it.
  3. **Gate badge strictly on `account.halted===true` (@AC-2/159):** rendering HALT_SOURCE[haltSource] unconditionally paints a stray '—' badge (UNSPECIFIED) on EVERY row incl OFFLINE → resurfaces a broker-derived field. Add e2e: a non-halted/offline row shows NO halt badge. (Halt sources BRACKET_PROTECTION/RECONCILIATION are unreachable for OFFLINE, so a gated badge never shows there.)
  4. **Silent-refetch failure (P-03/FR-4):** refreshAccounts()=fetchAccounts has `catch {}` (AccountContext.tsx:41-43) — if the post-resume refetch fails, resume succeeded but indicator still shows halted. FIX: update context state from ResumeAccountResponse.account (optimistic), then background refetch.
  5. **FR-2 AccountSelector under-delivery (OPEN for round 2):** the warning-dot OR shows neither reason nor source — a partial delivery of a literally-named FR-2 surface. Needs explicit sign-off that the dot satisfies FR-2 (detail deferred to the row), OR add the full indicator to the selector. Confirm a halted account stays in the activeAccounts filter so the dot fires. **← unresolved; ask user at round-2 gate.**
  6. Correct the product-spec Open Questions citation: `docs/context-constitution-findings.md` does NOT record the admin-vs-operator discrepancy (recon confirmed) — fix the citation.
  7. Minor: browser tradingClient already exposes resumeAccount (no-op); the load-bearing change is the traderBff.ts registration.
  - Nav reachability (fails.md:71) NOT triggered — /trader/accounts pre-exists in AppShell.
- **NEXT (round 2):** re-propose admin-only (locked) + BFF non-admin rejection test, halted-gated badge + offline e2e, optimistic clear from RPC response, corrected findings citation; surface the AccountSelector FR-2-dot sign-off (#5) at the round-2 user gate.
