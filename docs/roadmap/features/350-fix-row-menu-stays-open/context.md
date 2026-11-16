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

## Session 2026-11-16 — sdd-design round-2 gate (operator answers, verbatim options)

- Round 2 ran: adversary verdict NEEDS WORK, no Floor breach, "third round not needed"; register delta D-10..D-14, R-8..R-10, O-12..O-18, petition P-1 (REOPEN O-8: the D-3 guard test cannot fail in Chromium).
- Design approval: **"Run round 3"** — option text: "Another proposer/adversary round with the petition accepted." The design is NOT approved. P-1 → `user reopened`; O-8 → reopened @ round 3.
- Button names: **"Unique names (Recommended)"** — orders "Actions for order {orderId}", strategies "Actions for {strategyId}" (closes O-15).

## Session 2026-11-16 — sdd-design (approved)

- Round-3 gate, operator answers (verbatim options): design — **"Approve (Recommended)"**; new scenarios — **"Add and promote (Recommended)"** (`@AC-9`, `@AC-10` and one sentence each on FR-1 and FR-3 are added and join the durable suite approved in advance).
- Phase 1 Grilling: 3 rounds (quick, extended twice by the operator). Round 3: adversary verdict SOUND with amendments; register delta D-15..D-19, R-11..R-13, O-19..O-22 (all closed); O-8 and O-12 closed by D-17. No Floor breach in any round.
- Chosen approach: close on select in the shared `RowActionsMenu`, focus back to the row's trigger (fallback: the page's `<main>`), keyboard focus kept inside the dialog while the menu closes, orders and strategies adopt the shared menu, a stable actions cell on every table. Rejected: deferring the dialog, `modal={false}`, hand-controlled menu state, hook-only sharing, a DataTable-level cell fix (R-1..R-13 in debate.md).
- Measured before round 3 (recon.md addendum): keyboard path 0 focus events with the guard, 2 without; mouse path keeps one pair toward the closing menu's content.
- Constitution rules touched: C-10, C-12, C-13, C-14, C-15, C-16, C-17, C-18, P-04, P-06, F-04, F-05, F-08. Floor breaches: none.
- Ledger: read (fails 2026-09-16, 2026-11-15, 2026-11-16 ×2, :793-801, :1647-1649; insights 2026-09-05). Writes (superseding entries, D-9, and the columns-remount trap) are Step 5 of the build order.
- Open threads (design.md § Open Risks): React 19 ref dependency (Step 1); mouse-path focus pair, strategies per-row disabled, two side defects (integration PR); Radix-internal event name in the guard test (Step 1); `theme-bundle.spec.ts` run (Step 1).
- Status: spec-ready → design-approved.

## Session 2026-11-16 — sdd-spec

- Tree: `feature/fix-row-menu-stays-open@e30da23 ≡ origin/feature/fix-row-menu-stays-open (merged origin/main-dev@78ab5ca)`. The preflight found `origin/main-dev` (2 docs commits of other features) not merged; it was merged and the merge commit pushed (`docs/sdd/tree-freshness.md` Sync). No file under `services/xstockstrat-ui/` changed, so recon.md's line numbers hold; every source and spec file cited was re-read on this tree.
- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Shape: D-19's four code units are each a `service` + `test` pair with `**Lands with**` (Steps 1+2, 3+4, 5+6, 7+8); Step 9 is the ledger append. No proto, migration, config key, env var or mock-backend change.
- Key codebase findings:
  - `composeEventHandlers` skips Radix's own `onCloseAutoFocus` handler once ours calls `preventDefault` (`react-dropdown-menu` `dist/index.mjs:114-118`, `react-dialog` `dist/index.mjs:154-157`), which is what the one-shot menu guard and the dialog focus rule rely on. `node_modules/.pnpm` is at the repo root, not under the service.
  - Config templates: a failed retire shows "template is in use" twice — the page's `CardNotice` inside `<main>` and the global mutation fallback outside it (`useManageTemplate` sets no `meta`). The `@AC-9` test scopes its locator to `getByRole('main')`.
  - Authorized apps: the page replaces the table with "Loading…" while it reloads (`page.tsx:39,242-251`), so a successful Disconnect always removes the trigger; a failed one does not reload, which is why the failed case is the `@AC-9` row.
  - The orders spec's item and dialog test ids (`edit-<id>`, `cancel-<id>`, `cancel-<id>-confirm`, `cancel-<id>-dismiss`) are referenced only by `e2e/trader/orders.spec.ts:174-216`; `OrdersTable` has one consumer (`trader/orders/page.tsx:55`).
  - `account-resume.spec.ts` already uses `@AC-1..@AC-6` (feature 179) and `orders.spec.ts` uses `@AC-10` (feature 270), so this feature's tests sit in `(feature 350)` describe blocks and are selected with `-g "feature 350.*@AC-N"`.
- Assumptions made by this session (also listed in the spec's Execution Summary):
  - `service` + `test` pairs instead of five single steps; basis: the spec template and the feature-339 spec.
  - `@AC-7`'s source-filter line gets a guard test in `e2e/insights/opportunities.spec.ts` (Step 6); D-19 names only the orders spec there. Basis: C-15. No production file changes for it.
  - The D-13 marker helpers share one new module with the D-7 settle helper (`e2e/helpers/rowMenu.ts`); basis: four specs use them.
  - "No outline" on `<main>` is the `outline-none` class (precedent `alert-dialog.tsx:53`).
  - Authorized-apps `@AC-4` serves its first list through the real BFF (`route.fallback()`) instead of copying the inline app literal; basis: C-12.
  - No full local Playwright run is specified (fails.md 2026-08-10); scoped runs per step, full suite in the `frontend-e2e` CI job.
- Open threads for `/sdd-execute`: the D-17 mutation run (Step 2) must fail 5/5 in dev and in the production build, or the unit stops for the operator; a permanent `body > [aria-hidden="true"]` node on any page is a deviation, not a reason to loosen the settle helper; integration PR obligations (durable-suite promotion `@feature-350`, the four reported residues) are listed in the spec's Execution Summary.
- Not committed by this session: implementation-spec.md (new), status.md, feature.md, context.md.

## Session 2026-11-16 — sdd-review impl-spec (advisory)

- Tree: `feature/fix-row-menu-stays-open@a80fd740` ≡ origin, `origin/main-dev@78ab5cac` merged.
- Result: 1 failure, 11 warnings (advisory — did not block). All twelve were Verification-block form (chained `cd`/`&&`, greps that cannot fail, expected-fail commands not marked). No content finding, no Floor risk; anchors, copy, `@AC` coverage, atomic units and Files lists verified.
- Unresolved ✗ / ⚠ carried into execution:
  - Steps 1–9: Verification blocks — [x] rewritten before execution started (one command per line, `! grep` / `test … -eq N`, the mutation lines `!`-wrapped, `format:check` and `lint:dup` added, Playwright lines use the recorded production-build fallback). The step Instructions, Evidence and Files are untouched.
- Overlap findings (file-level, no config/proto/migration):
  - `src/app/accounts/authorized-apps/page.tsx` vs **345-authelia-sso** (implementation-ready, not executed): 345 moves the page body into a new `AuthorizedAppsList.tsx` and makes `page.tsx` a server component. Whichever lands second must carry the other's change; 350 lands first unless 345 is executed meanwhile. No merge-order row written (not a FAIL-level overlap) — reported to the operator at the integration PR.
  - `e2e/config-ui/templates.spec.ts` (339), `src/components/trader/AppShell.tsx` (344), `docs/patterns/ui-ux-governance.md` (342): all `code-completed`; text-level only.

## Session 2026-11-16 — sdd-execute (sequential)

- Mode entry and the per-feature up-front confirm (sequential-mode §5.1b/§5.4) were not asked: the operator's handover names `/sdd-execute fix-row-menu-stays-open sequential` and gives standing authorization for checkpoints that only report progress (authorization reference: the /sdd-triage session entry above). Checkpoint reports are written here and in the PR; operator-reserved gates were already answered (design, new scenarios, promotion) or remain (merge).
- Re-spec gate: directive none; the spec was generated on this tree minutes earlier and only its Verification blocks were hardened before the loop (impl-spec review entry). No step mismatch.
- Tooling setup (steps 1–9): node v24 ✓ (`/opt/node24/bin` first on PATH) · pnpm 9.15.9 ✓ · `pnpm install --frozen-lockfile` ✓ · Chromium ✓ (pre-installed, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) · Docker e2e image not attempted (recorded fallback from the handover: host-native production build).
- Tree at loop start: `feature/fix-row-menu-stays-open@dcb267aa` ≡ origin, `origin/main-dev@78ab5cac` merged.

### Step 1 — service: `RowActionsMenu` closes on select and returns focus; focusable `<main>` [done]
- Unit with Step 2. Confirm items no longer `preventDefault`; one-shot `skipMenuCloseFocus` on the menu's `onCloseAutoFocus`; the dialog's `onCloseAutoFocus` focuses the trigger or the enclosing `<main>`; layout-effect cleanup moves focus to `<main>` when the focused trigger unmounts; the four segment `<main>` got `tabIndex={-1}` + `outline-none`. Doc comment rewritten (2 lines); the "defer to the next tick" comment deleted.
- Files modified: `services/xstockstrat-ui/src/components/shared/RowActionsMenu.tsx`, `src/components/trader/AppShell.tsx`, `src/components/insights/AppShell.tsx`, `src/app/accounts/layout.tsx`, `src/app/config-ui/layout.tsx`
- Deviations: none

### Step 2 — test: shared settle helper; accounts, authorized-apps and templates confirm flows; keyboard guard [done]
- Unit with Step 1. New `e2e/helpers/rowMenu.ts`; feature-350 describe blocks in three specs; the feature-179 `@AC-3` workaround (comment, dialog wait, Escape) removed.
- RED on the pre-unit tree (production build, 9 failed / 0 passed):
  - AC-1 accounts Resume — `[role="menu"]` count: expected 0, received 1.
  - AC-2/AC-3 Resume dismiss and confirm — settle helper, `[role="menu"]` expected 0, received 1.
  - AC-4 accounts Remove and authorized-apps Disconnect — `expect(main).toBeFocused()`: received inactive.
  - AC-6 accounts Remove, authorized-apps Disconnect, templates Retire (dismiss) — `[role="menu"]` expected 0, received 1.
  - AC-10 — `page.waitForFunction` timed out (the menu never closes, so its close-focus never runs): RED for that reason only, as the spec states.
- GREEN after Step 1 (production build): the three specs `21 passed`; neighbours (`account-selector`, `offline-accounts`, `signal-sources`, `theme-bundle`) `43 passed`.
- D-17 mutation (guard branch deleted): production build `5 failed`, each on `expect(received).toEqual([])` with `"focusout Cancel <- Actions for Alpaca Paper", "focusin Cancel <- none"`; dev server `5 failed` (4 on that assertion, 1 on a `page.goto` compile timeout). Restored: production build `5 passed`; dev server `4 passed, 1 failed` (same first-navigation compile timeout). `lint`, `tsc --noEmit`, `format:check`, `lint:dup` exit 0.
- Open risk closed: the trigger ref reaches the DOM button (AC-3 green) — the React 19 ref dependency holds today.
- Files modified: `services/xstockstrat-ui/e2e/helpers/rowMenu.ts`, `e2e/trader/account-resume.spec.ts`, `e2e/accounts/authorized-apps.spec.ts`, `e2e/config-ui/templates.spec.ts`
- Deviations: Playwright invoked through the prebuilt path; dev-server repeats lose the first run to route compilation (Deviation Log).
