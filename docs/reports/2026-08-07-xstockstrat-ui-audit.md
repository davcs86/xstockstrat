# xstockstrat-ui Website Audit — 2026-08-07

**Scope**: `services/xstockstrat-ui` (the "website" — all four segments: `/trader`, `/insights`,
`/config-ui`, `/accounts`) plus a cross-check of `docs/reports/` defect history and open bug-type
SDD features. Codebase-based audit (read-only; no live browser session against the deployed
DigitalOcean app). Prompted by a user request to make the Screener's Fundamental metric field a
selector (see `docs/roadmap/features/117-screener-fundamental-metric-selector/`) plus a general
site audit.

GitHub Issues are disabled on this repo, so per `docs/runbooks/bug-triage.md` this report is the
audit trail. Nothing in this report has been fixed yet except where explicitly noted (§0).

---

## 0. Fixed in this session

- **Screener Fundamental metric field**: converted from free-text `<Input>` to a catalog-driven
  Radix `Select` (`services/xstockstrat-analysis`'s 11 known metric names). See feature
  `117-screener-fundamental-metric-selector`. This also removes one instance of finding §1 below
  for that specific field (the Fundamental branch), though the Technical-indicator and
  kind/comparator selects on the same page remain native `<select>` — out of scope for that
  feature, still tracked in §1.

---

## 1. Accessibility: colliding `aria-label`s (accessibility-blocking)

The most severe, recurring class of defect. Playwright's `getByLabel()` and screen readers both
rely on a unique accessible name; several list/repeat UIs hardcode the same `aria-label` across
every row or every mounted instance instead of indexing it.

| Location | Collision trigger | Severity |
|---|---|---|
| `src/components/insights/RuleEditor.tsx:180,200,219,231` (mounted twice at `StrategyWizard.tsx:270,276` — "Entry rule" + "Exit rule") | **Always** — both instances render simultaneously on every visit to Strategy Wizard Step 3 (`/insights/strategies/new` and `/insights/strategies/[id]/edit`) | Worst — 100% collision rate, not an edge case |
| `src/components/insights/RuleEditor.tsx` internal `tree.conditions.map` (`:197`) | Once a single rule has ≥2 conditions | High |
| `src/components/insights/ComponentEditor.tsx:82,93` (mounted via `StrategyWizard.tsx:246` `components.map` with no index threaded through) | Once a strategy has ≥2 indicator/formula components (common) | High |
| `src/app/insights/screener/page.tsx` — every criterion-row control (`kind`, `metric`, `comparator`, `threshold`, `hard filter`, `rank only`, `remove criterion`, `weight slider`, `weight`) | Once ≥2 criteria rows exist (one click of "Add criterion") | High — this is the exact collision class `design.md` for feature 117 flagged as a pre-existing, out-of-scope risk for the `metric` field specifically; it turns out to already apply to every other control on the row too |

**The fix pattern already exists** elsewhere in the same codebase and should be the template:
`src/components/insights/OutputEditor.tsx` (`` `output name ${i}` ``), `ParameterEditor.tsx`
(`` `parameter name ${i}` ``), `WatchlistReadiness.tsx:84` (`` `Strategy for ${symbol}` ``).

**Recommendation**: route as a bug fix (Track A/B/C per `docs/runbooks/bug-triage.md` — these are
confirmed defects, not new capability, so exempt from the full `/sdd-design` gate). Given the
breadth (3 components, multiple call sites), recommend `/sdd-triage` scoping it as one Track C bug
fix touching `RuleEditor.tsx`, `ComponentEditor.tsx`, and `screener/page.tsx` together, with an e2e
regression test per component asserting `getByLabel` resolves uniquely with 2+ rows/instances.

## 2. Accessibility: missing accessible names (accessibility-blocking)

| Location | Issue |
|---|---|
| `src/components/trader/AlertStream.tsx:47` | Icon-only bell button (`<Button variant="outline" size="icon">` wrapping only `<Bell>`) has no `aria-label`/`sr-only` text at all. Contrast: the mobile-nav button right next to it in `PlatformHeader.tsx:197-199` does this correctly (`<span className="sr-only">Open menu</span>`) — the fix pattern is already in use one component away. |
| `src/app/insights/backfills/page.tsx:230,272,362` | Three native `<select>`s (timeframe, status filter, delete-panel timeframe) with no `aria-label` and no associated `<label>` — announced to a screen reader only as an unlabeled combobox. |
| `src/app/insights/strategies/[id]/page.tsx:483` | `<tr role="button" aria-selected={...}>` — `aria-selected` is invalid on `role="button"` (only valid on `option`/`row`/`tab`/`gridcell`/`treeitem`); it's silently dropped by browsers/AT, so the selected backtest run isn't conveyed to assistive tech. This is also the **only** `pnpm run lint` warning in the entire repo (`jsx-a11y/role-supports-aria-props`). |
| `src/components/trader/OrderForm.tsx:134-204` | Symbol/Quantity/Limit/Stop `<Input>`s rely on `placeholder` only, no `<label>`/`aria-label`. |
| `StrategyWizard.tsx`, `FormulaWorkspace.tsx`, `config-ui/sources/page.tsx` (many fields) | `<label>` rendered as a plain sibling, never paired via `htmlFor`/`id` or wrapping — only **4** of ~45 `<label>` usages in the whole `src/` tree correctly associate (`watchlists/page.tsx:95`, `screener/page.tsx:180`, `config-ui/sources/page.tsx:512`, `trader/positions/page.tsx:235`). `EditOrderDialog.tsx:66-81`'s wrap-the-input-in-the-label pattern is the cleanest fix template. |
| `src/app/config-ui/[namespace]/NamespaceEditor.tsx:177-193` | Inline key-value edit inputs have no label/aria-label at all; only the column header gives (non-programmatic) context. |

**Recommendation**: same bug-fix track as §1; can likely land as one PR sweeping both.

## 3. UI control-type inconsistency (cosmetic → UX-degrading)

Every part of the app except `/insights` consistently uses the Radix `Select` component
(`@/components/ui/select`). Six native `<select>` elements remain, all in `/insights`:
`screener/page.tsx:211` (kind), `:233` (technical-indicator metric — the sibling of the field this
session converted to Radix), `:262` (comparator), and `backfills/page.tsx:230,272,362`. Not a
functional bug, but a visual/interaction inconsistency (unstyled native dropdown next to styled
Radix triggers on the same row, in the Screener's case).

**Recommendation**: low priority; bundle into a future Screener/Backfills polish pass rather than a
dedicated fix.

## 4. Empty/loading/error state duplication (cosmetic → UX-degrading)

Three shared components exist for this (`CardNotice.tsx`, `QueryStateMessages.tsx`,
`EmptyState.tsx` + `ui/skeleton.tsx`), but adoption is inconsistent:

- **Fully adopted**: `trader/positions/page.tsx`, `insights/opportunities/page.tsx` (Skeleton +
  EmptyState).
- **Partially adopted**: `trader/portfolio/page.tsx` is the only page using `CardNotice`;
  `OrdersTable.tsx`/`OrderBook.tsx` are the only consumers of `QueryStateMessages` despite its own
  doc comment calling itself "the DRY guard rail" single source of truth.
- **Hand-rolled** (13+ files): `watchlists/page.tsx`, `formulas/page.tsx`, `formulas/[id]/page.tsx`,
  `strategies/page.tsx`, `strategies/[id]/page.tsx`, `backfills/page.tsx`, `config-ui/sources/page.tsx`,
  `config-ui/[namespace]/NamespaceEditor.tsx`, `accounts/authorized-apps/page.tsx`,
  `accounts/mcp-tools/page.tsx` each independently write near-identical
  `<p className="text-sm text-destructive">Failed to load X</p>`-style markup. None of the three
  shared components *or* the hand-rolled versions add `role="alert"`/`aria-live` — a sighted user
  sees the error appear, a screen-reader user gets no announcement, platform-wide.

**Recommendation**: worth a dedicated DRY-guard-rail-style cleanup feature (not a bug — it's
inconsistent-but-working, i.e. new-capability-shaped "converge on the canonical component" work),
plus adding `aria-live="polite"`/`role="alert"` to `QueryStateMessages`/`CardNotice`/`EmptyState`
once adopted everywhere.

## 5. Dead code

- `src/lib/basepath.ts:1` — `BASE_PATH_TRADER` is exported but never imported anywhere in `src/`
  (its siblings `BASE_PATH_INSIGHTS`/`BASE_PATH_CONFIG_UI` are actively used). Also confirms the
  already-tracked gap in `docs/context-constitution-findings.md:10`: there is no
  `BASE_PATH_ACCOUNTS` despite `/accounts` being a shipped 4th segment.
- `PLATFORM_SUBNAV` + the `segment`/`subNav` props on `PlatformHeader` (`PlatformHeader.tsx:57-101`)
  are fully dead — `PlatformHeaderInner` never destructures or renders them (doc comments at
  `:98,100` already self-flag as "Legacy: ... ignored") — yet four call sites still compute and
  pass them for no effect: `components/trader/AppShell.tsx:19`, `components/insights/AppShell.tsx:15-20`
  (the worst case — it does admin-conditional array-building work that's thrown away),
  `app/accounts/layout.tsx:22`, `app/config-ui/layout.tsx:13`.

**Recommendation**: trivial, low-risk cleanup — delete `PLATFORM_SUBNAV`, the two dead props, and
the four pass-through call sites (or the unused `BASE_PATH_TRADER` const). Good Track A/B
mechanical-fix candidate.

## 6. Nav reachability, TODOs, console.log — clean

- **Nav reachability (Constitution C-10(a))**: every one of the 29 `page.tsx` files is either a
  `NAV_GROUPS` entry or a legitimate deep-link/detail page reached from a parent list/card/redirect.
  No orphaned pages, no nav→route mismatches (all 17 `NAV_GROUPS` hrefs resolve to a real page).
- **`TODO`/`FIXME`/`XXX`/`HACK`/`@deprecated`**: zero hits in `src/` (the only "deprecated" matches
  are prose describing an *upstream proto field's* deprecation, not local incomplete work).
- **`console.log(`**: zero hits in `src/` (excluding tests); the only `console.*` calls are
  intentional `error`/`warn`/`info`.

## 7. Open defects / stale SDD tracking (informational)

Cross-checked all 8 `docs/reports/` defect write-ups against the current tree and all open
bug-type SDD features:

- **Genuinely still open**:
  - `094-fix-mcp-server-input-validation` (SEV-3, status `code-completed`, not yet `launched`) —
    `ingest_signal`/`emit_alert` lack server-side range/emptiness validation.
  - The `exit-cooldown` report's `max_strategies_per_cycle` no-rotation starvation issue — the
    report explicitly states feature 116 didn't fix it and defers it to later triage; confirmed
    `services/xstockstrat-analysis/app/engine/live_loop.py:185-206` still has no rotation logic.
- **Stale lifecycle tracking, not a live bug**: `076-fmp-key-to-secret-env`,
  `077-fix-listkeys-wire-encoding`, and `078-fix-config-scope-resolution` all show
  `**Lifecycle Status**: code-completed` with no `Committed to main`/`Launched date` fields, but
  their fixes were directly confirmed present in the current `main-dev` tree (e.g.
  `services/xstockstrat-config/src/grpc/configServiceImpl.ts:80-105`'s `resolveEnv`/`resolveMode`,
  which carries an explicit doc comment describing and fixing the exact SEV-1 bug 078 reports).
  Since `main` and `main-dev` are at the same commit as of today's promotion (PR #896), these fixes
  are already in production — only the SDD tracking metadata is stale. Every other defect report
  checked (F-1…F-13 in the MCP triage report, the config-ui env/duplicate-key defects, the
  disabled-strategies defect, the WatchConfig scope-omission hotfix, the target-user authz defect)
  is fixed-and-verified in the current tree.

**Recommendation**: run `/sdd-sync` or manually verify+flip `076`/`077`/`078`'s (and confirm `094`'s
actual state) `feature.md` status to `launched` once the exact merge commit is confirmed — do not
guess a commit SHA. This report does not modify those files.

---

## Priority summary

| Priority | Finding | Files | Fix shape |
|---|---|---|---|
| High | §1 colliding `aria-label`s in RuleEditor/ComponentEditor/Screener | 3 files | Bug fix (Track C, index the labels) |
| High | §2 missing accessible names (AlertStream, Backfills selects, `aria-selected` misuse, unlabeled inputs) | ~8 files | Bug fix, can bundle with §1 |
| Medium | §5 dead `PLATFORM_SUBNAV`/props/`BASE_PATH_TRADER` | 6 files | Mechanical cleanup |
| Medium | §7 stale `code-completed` tracking on 076/077/078 | 3 `feature.md` files | `/sdd-sync` / manual verify |
| Low | §3 native `<select>` vs Radix inconsistency | 2 files (6 selects) | Polish, bundle with future Screener/Backfills work |
| Low | §4 empty/loading/error state duplication + missing `aria-live` | ~15 files | Dedicated convergence feature |
| Low | §7 open `094` (SEV-3) and exit-cooldown rotation defect | 2 items | Already tracked, no new action needed here |

No changes beyond §0 were made as part of this audit — findings are reported for triage, not
auto-fixed, per this repo's SDD entry-point rule (confirmed defects route through
`/sdd-triage`/`docs/runbooks/bug-triage.md`; the broader consistency items in §3/§4 are
capability-shaped and would need `/sdd-story` + `/sdd-design` first).
