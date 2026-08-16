# Context: shadcn-datatable-migration

**Feature**: `docs/roadmap/features/135-shadcn-datatable-migration/feature.md`
**Product Spec**: `docs/roadmap/features/135-shadcn-datatable-migration/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/135-shadcn-datatable-migration/implementation-spec.md`

---

## Session 2026-08-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- User instruction: migrate ALL tables (native HTML, shadcn `Table`, or any other library) to the
  shadcn `DataTable` pattern, and ensure horizontal responsiveness (evaluate scrollable container vs
  other strategies per table). Explicit instruction to automate as much of the SDD pipeline as
  possible.
- Prior background check (this session, before /sdd-story) confirmed: no existing PR for branch
  `claude/migrate-tables-shadcn-datatable-jbccqa`, no pre-existing SDD feature covering this work.
  Related, already-`launched` sibling features (119–124) migrated raw `<table>` markup onto the
  shadcn `Table` *primitive* (not the TanStack `DataTable` pattern) — this feature is the next step
  up, not a duplicate of that work.
- Known trap surfaced from `docs/roadmap/ledger/fails.md` (2026-08-06,
  `083-ui-revamp-opportunities-first`): a table's horizontal-overflow regression on mobile was
  caught only by a later dedicated sweep (`e2e/mobile-overflow.spec.ts`), not at the fidelity-claim
  step. This feature's FR-5 requires the automated overflow assertion to land with each table's
  migration, reusing/extending that existing spec file rather than deferring to a final pass.
- Also relevant from the ledger (2026-08-08/2026-08-09, sibling shadcn-migration features
  121/122/123 and 120): (a) a nested subagent delegated an entire `/sdd-design` session cannot be
  assumed to have `Task`/`AskUserQuestion` access — genuine architecture forks must stay gated at
  the orchestrator level or be explicitly re-surfaced to the user; (b) shadcn's `Breadcrumb`
  primitive collided with Playwright `getByRole`/`getByLabel` locators on unrelated specs, only
  caught by a broader `-g` run — worth keeping in mind if this feature's design touches any nav/
  breadcrumb-adjacent markup incidentally.

## Session 2026-08-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (advisory, non-blocking):
  - AC1/AC3/AC5 are qualitative rather than quantitative ("no table implementation left
    undiscovered", "no regression in what data a table shows") — acceptable per the criteria's own
    WARN condition, not a FAIL.
  - One Open Question remains unresolved, explicitly deferred to `/sdd-design` recon (the exact set
    of "small static lookup" tables exempt from FR-3). Matches accepted repo precedent (sibling
    feature 124 passed review with the same deferral pattern) but flagged for visibility.
- Overlap findings (soft/rebase-level file collisions only — no config/proto/migration FAIL):
  - **124-shadcn-table-actions-responsive** (`code-completed`): already converted Orders/Strategies/
    Config-Sources/Namespace-editor Actions columns to `DropdownMenu` and two raw-`<table>` sites to
    the `Table` primitive. **135's recon must treat 124's landed markup as the migration baseline**,
    not re-derive from a pre-124 mental model.
  - **124** also extends `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts`'s `ROUTES` list with
    the same gap set 135's FR-5 targets — both features edit the same array; expect a rebase, not a
    silent conflict.
  - **125-unified-symbol-page** (`implementation-ready`): may relocate/redirect
    `trader/positions/[symbol]/page.tsx` and `trader/orders/[id]/page.tsx`'s tables before 135
    executes. If 125 merges first, 135's recon/design must re-verify those two routes' table
    structure against 125's landed shape rather than the pre-125 one.
  - Recorded per `docs/roadmap/features/merge-order.md:58` precedent (same file pair already flagged
    between 096/124) — recommend adding a `135` row to `merge-order.md` once 135 reaches
    `implementation-ready`, sequencing it after 124 (closest to merge) and re-checked against 125 if
    that merges first. Not a blocking gate today (no config/proto/migration collision exists).

## Session 2026-08-15 — warnings addressed (pre-design)

Addressed both `/sdd-review product-spec` warnings directly in `product-spec.md` before starting
`/sdd-design`:

- **AC1/AC3/AC5 qualitative → quantitative.** Rewrote all six ACs to name a concrete, checkable
  condition (grep-derived inventory completeness, zero direct `@tanstack/react-table` imports
  outside the shared composite, an explicit per-table disposition record, zero undocumented missing
  routes in the overflow sweep, assertion-parity pre/post migration, suite exit code 0).
- **Open Question resolved.** FR-3's exemption for staying on the plain `Table` primitive was an
  open design choice ("recon should confirm the exact set..."); replaced with a fixed, measurable
  three-part threshold (row count ≤ 10 and static/bounded, column count ≤ 4, read-only) directly in
  FR-3. Recon's job is now to *measure* inventory entries against this rule, not decide the rule
  itself. `## Open Questions` is now empty.
- No re-run of `/sdd-review product-spec` performed yet — these are refinements of an
  already-PASSED review (no new criterion introduced, no scope change), not a reversal of the
  approval. `feature.md` stays at `spec-ready`; proceeding to `/sdd-design` next.

## Session 2026-08-15 — sdd-design Phase 0 (recon)

- Spawned 3 parallel `codebase-discovery` subagents (trader, insights, config-ui+shared-infra),
  plus a direct check of one flagged gap (`accounts/authorized-apps/page.tsx`). Wrote `recon.md`.
- **C-14 correction found during recon**: the product spec's `## Consumer Surface(s)` and FR-1 said
  "all three UI segments" (`/trader`, `/insights`, `/config-ui`) but `xstockstrat-ui` has a 4th
  segment, `/accounts` (OAuth authorized-apps UI, per `services/xstockstrat-ui/CLAUDE.md` §
  Segments), which also renders a table (`authorized-apps/page.tsx`, 5 cols, Revoke action).
  Corrected `product-spec.md`'s FR-1, Consumer Surface(s), and User Story to name all four segments
  before writing recon.md — a strengthening correction (adds scope recon already needed to cover
  per FR-1's own "audit every page/component" instruction), not a scope change requiring
  re-approval.
- **Full inventory: 15 table sites across all 4 segments** (7 trader, 4 insights, 3 config-ui, 1
  accounts). Every one fails FR-3's fixed exemption threshold — flagged as a risk for the grilling
  round (is a literally-zero-exemption outcome intended, or should the 3-column nested Sheet
  fill-lineage table get a design-level exception?).
- Confirmed via all three digests: **zero raw `<table>` elements** and **zero existing table/grid
  library** (`@tanstack/react-table` not installed) anywhere in `services/xstockstrat-ui` — 100% of
  existing tables already go through the shadcn `Table` styling primitive.
  `mobile-overflow.spec.ts` needs no code change for FR-5, only `ROUTES` data additions (confirmed
  it doesn't yet cover the bare `/trader` dashboard route, where `OrderBook`/`LiveStrategiesPanel`
  render).
- Flagged `BacktestDiagnostics.tsx` (a `@tanstack/react-virtual` div-grid, not a `<table>`/`Table`
  primitive) as explicitly out of FR-1's literal scope — for the grilling round to confirm.
- Proceeding to Phase 1 — Grilling (quick mode, 1 mandated round).

## Session 2026-08-15 — sdd-design Phase 1 (grilling, 5 rounds)

User opted to run rounds beyond quick mode's 1-round minimum each time a round surfaced fixable
issues, ending at 5 (the hard cap). Zero Constitution Floor breaches were found or flagged at any
round. Per-round summary:

- **Round 1** (proposer + adversary): established the core shape — one `ui/data-table.tsx`
  composite wrapping the existing `Table` primitive + `@tanstack/react-table`, reusing feature 124's
  `DropdownMenu` Actions-cell pattern. Adversary found: (a) the proposed `useIsMobile()`-driven
  column-visibility for row 2 (Exposure table) would have silently regressed an already-working CSS
  3-tier breakpoint mechanism (`positions/page.tsx:311-327`) that neither recon nor round 1 had
  checked for; (b) an internal contradiction — pagination "baked in as always-on" vs. row 3 needing
  "no pagination UI"; (c) row 2's proposed client pagination would double up with its existing
  server-side keyset Prev/Next controls; (d) an arithmetic/prose inconsistency in the responsive-
  strategy tally; (e) row 3's Sheet-nested table can't be overflow-tested by a plain
  `mobile-overflow.spec.ts` `ROUTES` addition since that sweep never clicks to open the Sheet; (f)
  `OrdersTable.tsx`'s live-merged data array needs `useMemo` before becoming the composite's `data`
  prop (TanStack Table requires stable data-reference identity), citing a near-identical bug already
  on record in this codebase (`fails.md` 2026-08-08, `screener-data-readiness-polling`). All folded
  into the synthesis as fixes.
- **Round 2**: resolved rows 6–7's (`LiveStrategiesPanel.tsx`, `OrderBook.tsx`) sort-semantics
  question — proposer verified against actual code (not the misleading "OrderBook" name) that row 7
  renders the user's own order list via the same `useOrders` hook as row 5, not a price ladder, so
  sort stays enabled on both. Proposer also found a genuine new composite requirement: `onRowClick`,
  needed at rows 6 and 10 (both have existing `role="button"`/keyboard row-activation the round-1
  composite design never accounted for). Adversary verified the DropdownMenu/`OrderBook` claims held
  but found the `onRowClick` site count was incomplete — 2 more sites needed it (row 2's Sheet-opener,
  row 11's Formulas row-navigation, the latter masked by recon's technically-true-but-incomplete
  "existing mutation/actions: none" note) — plus an unstated keyboard-accessibility decision for row
  2 (currently mouse-only) and an unstated `stopPropagation` ownership contract, and found row 13
  (`NamespaceEditor.tsx`) needed recording as a distinct "stateful/conditional cell content" pattern,
  not a plain DropdownMenu swap.
- **Round 3**: proposer re-verified all of round 2's fixes against live source and self-caught a
  real internal contradiction — the "stopPropagation lives in the Actions-cell wrapper" framing
  didn't hold, since row 2 has no Actions/DropdownMenu column at all (`recon.md:49`); corrected to a
  generic row-level `isInteractiveTarget` guard. Also found a genuinely new, non-blocking item: rows
  4 and 7 both carry dead `cursor-pointer` CSS with zero click handler wired anywhere — needs an
  explicit per-row disposition, not a 5th `onRowClick` site. Final adversary pass on this round found
  the stopPropagation guard as re-worded only checked `click`, not `keydown` — a keyboard user
  pressing Enter on a nested button (row 6's Enable/Disable) would double-fire both the button's
  action and `onRowClick` simultaneously, reproducible today by design; also caught a column-count
  miscount (row 2 is 19 columns, not 18 — the `sr-only`-labeled "Trade" header still renders a
  visible cell/column).
- **Round 4**: proposer verified the keydown-guard fix concretely at rows 2 and 6, confirmed the
  19-column correction changes no other decided fact, and ran a full 15-row count sweep (no further
  discrepancies found). Surfaced the `data-row-click-ignore` escape-hatch requirement for future
  non-native-interactive cell content. Final narrow adversary check verified the fix specifically
  against the DropdownMenu-trigger case (the dominant real pattern, 6 of 15 sites) — confirmed sound
  (portal-wrapped menu content never bubbles to the row) — but flagged doc-only enforcement of
  `data-row-click-ignore` as a foreseeable silent-regression gap, citing this codebase's own
  `button.test.ts` precedent and a ledger lesson ("advice alone demonstrably did not hold," `fails.md`
  2026-07-30). Recommended fix: type `isInteractiveTarget`'s parameter as a small duck-typed
  interface so it's testable under the existing node-environment Vitest config with no new
  dependency (no jsdom needed), plus one unit test.
- **Round 5** (final, hard cap): consolidated all 4 prior rounds into the final `design.md` content,
  folding the unit-test requirement into the composite's own build step (not a separate step).
  Produced the final Rejected Alternatives and Open Risks lists.

User approved after round 5. `design.md` written; `feature.md` advanced `spec-ready` →
`design-approved`.

**Aside during this session**: user flagged a mobile-app screenshot referencing PR #960 and an
unrelated question, suspecting a parallel session. Investigated via `list_sessions` +
`pull_request_read` — confirmed PR #960 is this session's own auto-created PR for
`claude/migrate-tables-shadcn-datatable-jbccqa` (footer links to this session's own ID); no parallel
session exists. Resolved as a stale/cached mobile-client render, not a collision. No action needed.

## Session 2026-08-15 — sdd-spec

- Generated `implementation-spec.md` with 33 steps. Status → `implementation-ready`. Consumed
  `recon.md` + `design.md` directly (both present); re-read all 15 table call sites live (via `Read`,
  not from recon's summary alone) to ground every step's Codebase Evidence and confirm recon/design's
  claims still hold against current `main-dev` source.
- Step structure: composite build + unit test (Steps 1–2) → `/config-ui` rows 12–14 (Steps 3–8) →
  `/insights` rows 8–11 (Steps 9–16) → `/accounts` row 15 (Steps 17–18) → `/trader` rows 1, 4–7
  (Steps 19–28) → isolated 19-column Exposure table row 2 (Steps 29–30) → design-excepted fill-lineage
  row 3 (Steps 31–32) → full regression sweep (Step 33). Every `service` step paired 1:1 with an
  immediately-following `test` step (C-08).
- Key codebase findings confirmed live (beyond recon.md's summary):
  - `mobile-overflow.spec.ts` `ROUTES` (`e2e/mobile-overflow.spec.ts:12-34`) already covers **14 of
    the 15** migrated routes — only the bare `/trader` dashboard route (rows 6–7,
    `LiveStrategiesPanel`/`OrderBook`) is a genuine gap, added in Step 25. This is a stronger result
    than recon/design flagged — most FR-5 test steps need zero `ROUTES` changes, just a re-run of the
    existing entry against the migrated markup.
  - Row 4 (`positions/[symbol]/page.tsx:363`) and row 7 (`OrderBook.tsx:41`) both confirmed via direct
    `Read` to carry `cursor-pointer` (row 7 also `hover:bg-accent/40`) with **zero** click handler
    wired anywhere in either component — both dispositioned as "carried forward unchanged" per
    design.md's default recommendation (Steps 21, 27).
  - Row 6 (`LiveStrategiesPanel.tsx`): confirmed the exact keyboard double-fire bug design.md predicted
    — the Enable/Disable button's `onClick` (`:78`) calls `stopPropagation()` but no `onKeyDown` exists
    anywhere on that button, so a keyboard Enter today double-fires the mutation and the row's
    `setSelectedId`. Migrating to the composite's shared `isInteractiveTarget`-on-both-`click`-and-
    `keydown` guard (Step 25) is a genuine, intentional bug fix — Step 26 adds a red-before-green test
    for it specifically.
  - Row 3 (fill-lineage, `positions/page.tsx:578-604`): confirmed **zero** existing e2e coverage
    (`grep -r "lineage" e2e/` returns nothing) — Step 32's Sheet-open-then-measure overflow test is
    genuinely new coverage, not a preserved-behavior check, matching design.md's call-out that the
    generic `mobile-overflow.spec.ts` sweep structurally cannot reach it (never clicks).
  - No dedicated e2e spec was found asserting `/config-ui/audit`'s (row 14) or `OrderBook.tsx`'s
    (row 7) rendered table content — both existing coverage was limited to overflow/nav/data-contract
    checks. Steps 8 and 28 add the missing row-content assertions (both dispositioned as new coverage,
    not regression fixtures).
  - `@tanstack/react-table` pinned as `^8` (caret range, matching every other dependency in
    `package.json`) rather than an exact version — consistent with the repo's existing convention, no
    live-docs version check performed (not a functional-behavior claim requiring the 2026-08-10/
    2026-08-13 ledger "verify against live docs" pattern — a caret range resolves at install time
    either way).

## Session 2026-08-15 — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings (advisory — did not block). No Floor (`F-*`) violations. The
  reviewer independently re-verified ~20+ path:line citations across all 33 steps (every
  `mobile-overflow.spec.ts` `ROUTES` line, every table's column count including the 18→19 correction,
  the `LiveStrategiesPanel` keyboard double-fire bug) and found them all accurate.
- Unresolved ⚠ carried into execution:
  - Step 20: Codebase Evidence claims `e2e/trader/portfolio.spec.ts` directly imports
    `POSITION_AAPL`/`POSITION_MSFT`/`POSITIONS` from `e2e/fixtures/positions.ts` — grepped, zero
    matches; the spec never imports these symbols directly. The underlying data IS still centralized
    (sourced indirectly via `e2e/mock-backend.ts`'s `listPositions()` handler), so C-12 compliance
    itself isn't broken, but the citation as written is factually wrong (C-01). — [ ] unaddressed
  - Steps 9, 13, 23: each anticipates the possibility of extending the `DataTable` composite
    (`tableClassName` prop, per-row `data-testid`/`getRowProps` passthrough) beyond Step 1's shipped
    prop list (`columns, data, onRowClick, enablePagination, pageSize, emptyMessage, getRowId,
    rowClassName`), but none of the three list `data-table.tsx` in their `**Files**` section — if the
    extension proves necessary at execute time, staging that file would risk an **F-08** violation
    (never stage files outside the step's Files section). Each step already routes the contingency
    through the Deviation Log if needed (P-03-compliant), but the Files-list gap itself is unresolved.
    — [ ] unaddressed
  - Step 1/2: no explicit sentence stating that the composite's own Playwright/E2E coverage is
    intentionally deferred to the 15 downstream consumer-migration steps (a reasonable design, but
    stated only implicitly via `## Step Dependencies`, not as an explicit coverage-deferral note per
    B3). — [ ] unaddressed
- Overlap findings (soft/rebase-level file collisions only — no proto/config/migration FAIL; 135
  declares zero of those resource types):
  - `trader/positions/[symbol]/page.tsx` + `e2e/trader/position-detail.spec.ts` — this feature's
    Steps 21–22 vs. **125-unified-symbol-page** (`implementation-ready`) Steps 8–21/25, which
    page-structure-refactors most of the same file/spec. Real edit-surface overlap, not disjoint.
  - `e2e/trader/valuation-parity.spec.ts` — Step 30 vs. **125** Step 26.
  - `config-ui/sources/page.tsx` + `e2e/config-ui/sources.spec.ts` — Steps 3–4 vs.
    **134-signal-source-reliability-weight** (`implementation-ready`) Steps 8–9, which adds a
    `reliabilityWeight` column to the same 8-column table this feature migrates to `DataTable`.
    Whichever lands second must rebase its column-def onto the other's landed markup.
  - `e2e/insights/strategy-authoring.spec.ts` — Step 12 vs. **132-strategy-symbol-denylist**
    (`implementation-ready`) Step 16.
  - No `merge-order.md` entry exists for any of these pairs; the overlap agent recommends an
    advisory soft-overlap note (not a blocking row) once 135 starts executing, since none share a
    proto field/config key/migration NNN.

Per this skill's own protocol, `/sdd-execute` must announce every `[ ] unaddressed` item above at
each checkpoint and at session end (P-03) — mark `[x]` here in the same block when the step that
clears it lands, rather than letting the warning go stale.

## Session 2026-08-16 — sdd-execute boot (branch-topology correction, take 2)

- New session, new harness assignment: "Develop on branch `claude/shadcn-datatable-migration-6f307n`."
  Boot Step B3/B4 found this differs from `feature.md`'s recorded Development Branch
  (`claude/migrate-tables-shadcn-datatable-jbccqa`) — same recurring shape as the prior session's
  boot correction (immediately above) and ledger `fails.md` 2026-07-30 `082-fix-fmp-config-boot-only`.
- Checked whether prior work would be lost: `mcp__github__list_pull_requests` for
  `claude/migrate-tables-shadcn-datatable-jbccqa` found PR #960 already merged into `main-dev`
  (docs-only — all SDD artifacts for this feature, up to `implementation-ready`). Confirmed via
  `git diff origin/main-dev origin/claude/migrate-tables-shadcn-datatable-jbccqa` (empty) that
  `main-dev` already has everything from that branch. No code steps had been executed yet (all 33
  implementation-spec steps still `pending`), so there was no implementation work at risk either way.
- The newly assigned branch `claude/shadcn-datatable-migration-6f307n` already existed locally and
  on `origin`, but was stale (based on an old `main-dev` commit from before feature 125 merged, no
  unique commits, no PR ever opened from it — confirmed
  `git merge-base --is-ancestor claude/shadcn-datatable-migration-6f307n main-dev` = true).
  Applied the task instructions' "merged PR → restart" convention: `git checkout -B
  claude/shadcn-datatable-migration-6f307n origin/main-dev` (force-with-lease-equivalent reset; safe,
  since the branch carried only already-superseded history).
- Corrected `feature.md`'s **Development Branch** to `claude/shadcn-datatable-migration-6f307n`
  (Status History row added) rather than trying to keep working on the old, now-orphaned branch.
  Proceeding with sequential-mode execution of all 33 implementation-spec steps on this branch; the
  final integration PR will target `main-dev` from here, same as every other artifact PR.

## Session 2026-08-15 — sdd-execute boot (branch-topology correction)

- Boot Step B3 (`git ls-remote --heads origin feature/shadcn-datatable-migration`) found the
  spec's stated Development Branch does not exist on origin, and `origin/main-dev` doesn't have
  the feature docs either (expected — this feature hasn't merged). Root cause: this session's
  harness assignment ("Develop on branch `claude/migrate-tables-shadcn-datatable-jbccqa`",
  "NEVER push to a different branch without explicit permission") overrides
  `docs/runbooks/feature-workflow.md`'s default `feature/<slug>` branch model — every SDD artifact
  for this feature (`feature.md`, `product-spec.md`, `recon.md`, `design.md`,
  `implementation-spec.md`, this file) has, correctly, been authored and pushed to
  `claude/migrate-tables-shadcn-datatable-jbccqa` throughout, not a `feature/*` branch.
- Same branch-topology-mismatch shape as ledger `fails.md` 2026-07-30
  (`082-fix-fmp-config-boot-only`: "a skill that writes to a feature directory should verify early
  that the currently-checked-out branch and the feature's Development Branch are the same lineage").
  Caught here at `/sdd-execute`'s own boot sequence (B3/B4), same as that entry recommends — not
  mid-execution.
- Corrected `feature.md`'s `**Development Branch**` field to
  `claude/migrate-tables-shadcn-datatable-jbccqa` (matching reality) rather than creating a
  redundant `feature/shadcn-datatable-migration` branch that would violate the harness's explicit
  branch constraint. Recorded as its own Status History row (lifecycle unchanged).
  `/sdd-execute` proceeds treating `claude/migrate-tables-shadcn-datatable-jbccqa` as `<dev-branch>`
  for the remainder of this session — sequential mode commits steps directly to it, and the
  integration PR (already open as #960) targets `main-dev` from it, same as every other artifact
  PR this session has pushed.
