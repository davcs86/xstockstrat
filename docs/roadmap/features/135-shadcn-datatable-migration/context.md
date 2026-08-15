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
