# Context Log: fix-row-menu-stays-open

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-16 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-16-ui-row-menu-stays-open-after-confirm-defect.md` (Issues disabled; `--from-report`; landed on `main-dev` by PR #1559 at `87c504bf`). Sidecar stamped `triaged` / `ref: feature:350-fix-row-menu-stays-open`.
- Severity: SEV-3, environment staging (main-dev), not config-fixable → Track C.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-7), context.md.
- Affected services: xstockstrat-ui.
- Root cause: confirmed by reading on `main-dev@87c504bf` — `RowActionsMenu.tsx` item `onSelect` (`e.preventDefault(); setPending(action)`), `OrdersTable.tsx` Cancel item (`e.preventDefault(); setCancelling(order)`). The same shape exists in `src/app/insights/strategies/page.tsx` (Deactivate item); `src/app/insights/opportunities/page.tsx` is a deliberate keep-open multi-select checkbox item. Browser measurement of the strategies site is left to recon.
- History of the `preventDefault`: `OrdersTable` and strategies — `a2107eed` (feature 124, PR #919, 2026-08-09); shared `RowActionsMenu` — `c2077ddd` (PR #977, 2026-08-17). The shared component's comment says the dialog open is "deferred to the next tick"; the code defers nothing.
- Design depth: the rubric (`docs/sdd/design-depth-rubric.md`) gives `skip` for a SEV-3 single-service bug with a clear root cause; the operator chose `quick` in the task handover → `/sdd-design fix-row-menu-stays-open quick`.
- **Authorization reference (operator's handover, 2026-11-16, verbatim):** "The operator's instruction is: minimal human intervention. Treat that as standing authorization to proceed through checkpoints that only report progress, and record it verbatim in the feature's `context.md` as the authorization reference. It is NOT consent for the gates the Constitution reserves to the operator — design approval, sign-off on changing an existing durable scenario, the C-16 promotion plan, and merging any PR. For those: do all the work up to the gate, then ask ONCE, batching every open question into a single message, each with your recommendation and the consequence of each option in plain words. Never record your own reading of an ambiguous answer as the operator's decision; ask again. If an answer is "explain more", explain; it is not approval."
- Other operator constraints from the handover: UI only (stop and ask if recon finds a proto/config/migration/backend need); no config or data change on either staging and no staging MCP actions; no hotfix against `main`; `/sdd-execute … sequential`; one integration PR into `main-dev`, not merged by the session; no global animation or reduced-motion disable in tests.
- Assumptions made by this session:
  - Slug `fix-row-menu-stays-open` instead of the literal first-three-title-words form (`fix-a-rows-actions`); basis: prior bug features use descriptive slugs (328–349).
  - The strategies Deactivate item is in scope as a third site of the same defect; basis: identical code shape. Recon confirms or the design drops it.
  - The focus fallback when the row has gone (FR-3, @AC-4) is stated as an outcome only ("not on a removed element; Tab reaches the page"); the exact target is a design decision for the operator's gate.
- Development branch: feature/fix-row-menu-stays-open

## Session 2026-11-16 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: `feature/fix-row-menu-stays-open@d10eb257` == origin, `origin/main-dev@87c504bf` is an ancestor.
- A1b: not a re-attempt of any demoted feature (session's own judgement — none of the 22 concerns a row menu or a confirmation dialog).
- Warnings (all addressed in this session): AC-5/6/7 named no concrete table or action → concrete values and Examples added; FR-2's assistive-technology clause had no `Then` → added to @AC-2; FR-4 left out the strategies Deactivate menu although the surface list named it → FR-4 and @AC-6 now include it; @AC-3 carried a state check in `When` → moved to `Given`; the "key pressed right after Confirm" case had no scenario → @AC-8 appended. Still open for design: the FR-3 fallback focus target (@AC-4 states the outcome only).
- Overlap findings: none (CLEAN). 339 (`code-completed`) is behavioural context only (its PR #1550 enabled the dialog close animation); no merge-order entry needed.
- Recommended design depth: quick (single service, browser UI only, no proto/DB/config, no overlap).
- Recon lead found while fixing the Examples: `accountShared.tsx` "Edit keys" and `OrdersTable` "Edit" already open a dialog from a menu item WITHOUT `preventDefault` — a working in-repo instance of "menu closes, dialog opens" to measure before choosing the mechanism.

## Session 2026-11-16 — sdd-design (at the approval gate)

- Tree: `feature/fix-row-menu-stays-open@689a6c73` ≡ origin, `origin/main-dev@87c504bf` merged.
- Phase 0 Recon: wrote recon.md. Every existing durable scenario is PRESERVE (no CHANGE, no EXTEND). No escalation signal; stayed `quick`. The defect and two candidate fixes were measured in headless Chromium (recon.md § Browser measurements); the prototype edits and the scratch probe were reverted and deleted.
- `preventDefault` sites classified: `RowActionsMenu`, `OrdersTable`, strategies Deactivate = same defect; opportunities source filter = deliberate keep-open.
- Phase 1 Grilling: round 1 run (proposer + adversary). Adversary verdict NEEDS WORK, no Floor breach; 11 objections, 9 closed in synthesis (debate.md). The decisive finding: a rebuilt `columns` memo remounts every actions cell (D-5), so strategies and authorized apps need a stable cell for the focus rule to hold.
- Waiting on the operator (P-04; the handover reserves design approval): approve the design; adopt the shared menu in orders and strategies and the dialog text that makes visible; the focus fallback target; the C-16 promotion plan. Nothing is recorded as decided until the operator answers.
- Side defect found, out of scope, not filed: the "Edit keys" `FormDialog` opened from the row menu never receives focus (recon.md § Risks).

## Session 2026-11-16 — sdd-design round-1 gate (operator answers, verbatim options)

- Design approval: **"Run another round"** — the design is NOT approved; round 2 runs.
- Shared menu: **"Adopt, specific text (Recommended)"** — orders dialog: title "Cancel order", text "Cancel this {symbol} order?", buttons Dismiss / Confirm; strategies dialog: title "Deactivate strategy", existing text kept; Confirm buttons styled as destructive (D-4).
- Focus fallback: **"Main content region (Recommended)"** (D-6).
- C-16 promotion: **"Approve in advance (Recommended)"** — a new durable suite `services/xstockstrat-ui/acceptance/fix-row-menu-stays-open.feature`, tagged `@feature-350`, no existing suite edited; the plan is generated from the feature branch after execution and the exact text listed in the PR.
- No steer text was given with "Run another round"; round 2 takes the open objections (O-4, O-10, O-11), the per-site shape of D-5 and the React 19 ref dependency.
