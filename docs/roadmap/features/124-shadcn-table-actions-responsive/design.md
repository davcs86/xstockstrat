# Design: shadcn-table-actions-responsive

**Created**: 2026-08-09
**Rounds**: 4 (full; termination: approved after Round 4 fixes folded in)
**Approved by**: user @ 2026-08-09
**Grounded in**: recon.md (including the two mid-debate ADDENDUM/UPDATE sections)

---

## Chosen Approach

All 11 FRs are frontend-only, `xstockstrat-ui`. No proto/migration/config/inter-service touchpoint
anywhere (`recon.md` Dependencies, reconfirmed each round). Consumer surface: the UI segments named in
`product-spec.md` (`/trader`, `/insights`, `/config-ui`, `/accounts`) — every FR is directly visible on
those pages' existing tables, badges, filters, nav chrome, or mobile menu; no new route.

**Recommended `/sdd-spec` step order** (soft ordering except where marked hard):

1. **FR-1** — vendor `dropdown-menu.tsx` (`npx shadcn@latest add dropdown-menu`, `components.json:3`
   preset `bLTl5gh6`) + collateral-regeneration reconciliation (re-apply `buy`/`sell`/`paper`/`live`/
   `warning`/`info` variants per `services/xstockstrat-ui/CLAUDE.md` § Styling), verified via
   `button.test.ts`/`badge.test.ts`. *(Hard: must precede FR-2.)*
2. **FR-2** — convert the 4 confirmed Actions-column sites to a kebab-trigger `DropdownMenu`:
   `OrdersTable.tsx:124-160` (Edit + genuinely `AlertDialog`-gated Cancel), `config-ui/sources/page.tsx:340-350`
   (Disable/Enable + Edit), `NamespaceEditor.tsx:231-269` (Edit / Save+Cancel), `insights/strategies/page.tsx:210-218`
   (Edit + Deactivate — uses `window.confirm(...)`, not `AlertDialog`; corrected citation). Every action's
   exact existing behavior preserved. `authorized-apps/page.tsx`'s single-action Disconnect stays a plain
   `Button` (resolves product-spec Open Question — a menu around one item adds a click for no grouping
   benefit).
3. **FR-5** (narrowed) — raw `<table>` elimination for both original sites is **already done** by
   sibling features 121/122/123 (now merged to `main-dev`, PR #917). Remaining gap: strip the redundant
   `role="button"`/`tabIndex={0}`/`onKeyDown` from `strategies/[id]/page.tsx:490-506`'s Past Runs row
   (already has a real `TableRow`+`onClick`+`aria-selected`) — and, per explicit user direction, *add*
   the same keyboard affordance to `LiveStrategiesPanel.tsx:46-50` and `formulas/page.tsx:115-118`
   (currently mouse-only) rather than remove it from the row that has it. No clickable-row capability
   regresses; all three become keyboard-accessible.
4. **FR-7 + FR-8** (same file cluster) — `AlertStream.tsx`'s Badge conversion is **already done**,
   dropped from scope. `StrategyWizard.tsx:218-230`'s inner per-step `<span>` pill (nested inside the
   sibling-landed `QuestionnaireProgress` wrapper — 123 only replaced the outer `<ol>`, no conflict) →
   `Badge`-driven color logic. `opportunities/page.tsx:348` and `market/[symbol]/page.tsx:147`'s
   identical hand-rolled source pills → `Badge variant="outline"`. FR-8: the per-source `ToggleGroup
   type="multiple"` conversion is **already done**; only `opportunities/page.tsx:189-200`'s "All
   sources" toggle remains — restyle via `aria-pressed={activeSources.length === 0}` (verified: the
   base `toggle.tsx` class keys off `aria-pressed:bg-muted`; the `outline` variant has **no**
   `data-[state=on]` selector, so a `data-state`-based approach would produce zero visual change).
5. **FR-6** — new shared `Eyebrow` component under `src/components/shared/` (alongside `StatTile.tsx`'s
   convention) for the `font-mono text-[9px] font-semibold uppercase tracking-[0.13em]
   text-muted-foreground` literal — **14 occurrences across 7 files** (corrected from product-spec's
   original "9 files"): `market/[symbol]/page.tsx:29`, `positions/page.tsx:522,539`,
   `orders/[id]/page.tsx:172`, `positions/[symbol]/page.tsx:250,261,406,452,477,498` (×6),
   `portfolio/page.tsx:148,227`, `SignalReadiness.tsx:110`, `StatTile.tsx:21`. Runs before Steps 6/8
   touch the three files this FR shares with FR-9/FR-10 (`market/[symbol]`, `positions/[symbol]`,
   `orders/[id]`), so later steps land on settled content.
6. **FR-9** — `authorized-apps/page.tsx:204-205`'s `text-green-600`/`bg-green-600` (line numbers
   shifted from the product-spec's original `174-175` — 121's Table+AlertDialog conversion of this
   file added ~29 lines above them) → `text-buy`/`bg-buy`. The 3 static chart-height literals
   (`ChartPanel.tsx:157`, `positions/[symbol]/page.tsx:317`, `market/[symbol]/page.tsx:200`) convert
   to a Tailwind class only where that doesn't decouple the DOM height from the value each site also
   feeds `useCandlestickChart(N)`; any site left as-is is documented with why in `context.md` (may net
   to zero code changes — acceptable, not incomplete work).
7. **FR-11** — vendor `sidebar` (`npx shadcn@latest add sidebar`). Verified registry dependencies
   (`ui.shadcn.com/r/styles/new-york-v4/sidebar.json`): `button`/`separator`/`sheet`/`skeleton`
   (already vendored by feature 120 — same reconciliation check as FR-1/AC-1) plus net-new
   `tooltip.tsx` and a `use-mobile`/`useIsMobile` hook (no reconciliation needed, no prior
   customization to lose — supersedes product-spec's earlier "no tooltip.tsx gap" Out-of-Scope claim).
   Replace `PlatformHeaderInner`'s Row 1 `sm:hidden` trigger → `Sheet`+`Accordion` (`:223-280`) with
   `Sidebar collapsible="offcanvas"`. Reproduce the current single-open-group behavior
   (`Accordion type="single" collapsible`, `expanded`/`setExpanded` keyed to `activeGroup.key`,
   `:165,238-243`) by wrapping each `SidebarGroup` in the already-vendored `ui/collapsible.tsx`
   (landed by feature 121/122 — no new primitive needed). Preserve `visibleItems`/`adminOnly`
   filtering (`:167,258` — the admin-only `Backfills` entry must not leak to non-admins) and active-
   route highlighting; wire close-on-navigate via `useSidebar()`'s `setOpenMobile(false)`, mirroring
   the current `SheetClose asChild` behavior. **SSR mobile-detection mitigation**: keep
   `SidebarTrigger`'s visibility gated by the same pure-CSS `sm:hidden` class the current trigger
   already uses (never dependent on `useIsMobile()`'s client-only resolution); both `open`/`openMobile`
   default closed, so no panel renders visibly on first paint regardless of viewport — the only
   residual edge case (a click inside the sub-hydration window) is accepted as low-probability and
   verified empirically at `/sdd-spec`/execute time via a real-device/throttled-CPU check, not a
   hydration-waiting Playwright assertion. New e2e coverage (none exists today — `e2e/mobile.spec.ts`
   only tests `BottomTabBar`), including a non-admin-session assertion that `Backfills` stays absent.
8. **FR-10** — remove `PlatformHeader.tsx`'s Row 2 `Breadcrumb` block (`:286-302`) and the now-orphaned
   vertical `Separator` (`:303`) entirely — matches the product-spec's original ask ("move... into each
   page's own layout", not add a redundant second one alongside the shell's). **This does not leave the
   15 `nav-reachability.spec.ts` `GROUPS` routes without a guarantee**: `PlatformHeader.tsx:199-201`
   (`Primary` nav) and `:314` (`Section` nav) already set `aria-current="page"` on the active link —
   `nav-reachability.spec.ts:69-71`'s `getByLabel('Breadcrumb')` text-scrape is replaced with
   `aria-current="page"` checks against those links, preserving the "reflects the active screen"
   guarantee for all 15 routes via a different (already-existing) mechanism, exactly matching AC9's
   own anticipated "updated assertion strategy against wherever the breadcrumb now lives." A new
   shared `PageBreadcrumb` component (required `ariaLabel` prop, no default — the collision-avoidance
   mechanism itself) is added to **8 confirmed sites**: `strategies/[id]`, `strategies/[id]/edit`
   (confirmed real, distinct route; no `layout.tsx` — but neither does any of the other 6, so this
   doesn't distinguish it; Round 2's earlier exclusion rationale is superseded), `formulas/[id]`,
   `positions/[symbol]`, `market/[symbol]`, `orders/[id]` (6 new) + `NamespaceEditor.tsx`/
   `config-ui/audit/page.tsx` (2 existing, migrated onto the shared helper rather than left as parallel
   hand-rolled instances). New `e2e/breadcrumb.spec.ts`, table-driven, with a deliberately-constructed
   collision scenario (e.g. `/config-ui/audit`: the Settings group's real nav link "Audit log" vs. the
   migrated page's own terminal crumb "Audit Log" via `BreadcrumbPage`'s built-in `role="link"` — a
   genuine, already-present near-collision, not a fabricated one) proving the distinct-`aria-label`
   scoping actually disambiguates, run for **every** one of the 8 sites (not just one representative
   case) plus a full e2e-suite run as the closing gate — directly closing the `fails.md` 2026-08-09
   trap (caught twice before only by a later full-suite run, never a step's own targeted run).
   *Grounds its citations at execute time*, not this recon's pre-FR-6 line numbers, since FR-6 (Step 5)
   precedes it on 3 shared files. FR-10↔FR-11 order is arbitrary-but-safe (no real dependency between
   them — confirmed neither's registry/primitive needs touch the other) — whichever runs second
   inherits the shared import-block cleanup (`PlatformHeader.tsx:13-35`, both FRs make an import dead).
9. **FR-3** — extend `mobile-overflow.spec.ts`'s `ROUTES` (`:12-27`) with the 5 confirmed gaps:
   `/accounts/authorized-apps`, `/insights/formulas`, `/config-ui/audit`, a `/config-ui/<namespace>`
   route, `/trader/positions/<symbol>`. Runs after content steps so it measures final (post-conversion)
   markup, not pre-conversion widths.
10. **FR-4** — wide-content/tablet-width horizontal-overflow audit for every table-bearing page,
    checking `Table`'s built-in `overflow-x-auto` wrapper actually takes effect (root-cause class per
    `insights.md` 2026-08-06: a flex/grid ancestor missing `min-w-0` silently defeating it). Recorded
    in `context.md`; any table found overflowing is fixed and covered by a new/extended assertion.
11. **Closing gate** — `pnpm lint` + `NEXT_DISABLE_STANDALONE=1 pnpm build` clean throughout; full
    Playwright suite (chromium) green; `context.md` carries the FR-4/FR-9 audit records.

## Rejected Alternatives

- **Defer FR-5/FR-7's `AlertStream.tsx`/FR-8 to sibling features 121/123** (Round 1-2) — rejected: mid-
  debate discovery that 121/122/123 had already merged to `main-dev` (PR #917) made deferral moot;
  re-verification found each site either fully done or only narrowly incomplete.
- **Sequence FR-10 to execute only after 121 lands, via a `merge-order.md` F-04 tranche-split**
  (Round 2) — rejected by its own adversary pass: the PR-time-warning enforcement was too weak, the
  blocking chain was deeper than stated (transitively through 120 reaching `launched`), the collision
  test was unfalsifiable, and the wrong Constitution ID (`C-14`) was cited. Superseded once 121 was
  confirmed merged.
- **Treat FR-7's `StrategyWizard.tsx` site as architecturally incompatible with 123's
  `Questionnaire.Progress`** (Round 1-2) — rejected on reading the landed code: 123 only replaced the
  outer `<ol>` wrapper; the inner per-step pill is untouched and Badge-convertible, zero conflict.
- **FR-8's toggle styling via `data-state`+`toggleVariants`** (early Round 3) — rejected: verifiably
  broken (`toggle.tsx`'s `outline` variant has no `data-[state=on]` selector); replaced with
  `aria-pressed`.
- **FR-10 collision-safety covered by one representative test** (early Round 3) — rejected as
  insufficient given the recon's own risk note (2 prior collisions, both caught only by a later
  full-suite run); extended to cover all 8 sites plus a mandatory full-suite gate.
- **FR-10: keep the shared shell breadcrumb alongside new page-level ones (coexistence)** (raised by
  Round 4's adversary) — rejected: the product-spec's own problem statement asks to *move* the
  breadcrumb out of the shell, not duplicate it; the `aria-current`-based reachability replacement
  already preserves the guarantee for all 15 `GROUPS` routes without keeping a redundant generic
  breadcrumb on every page.
- **Exclude `insights/strategies/[id]/edit` from FR-10's site list** (Round 2's original position) —
  rejected on direct verification: its stated exclusion reason (no `layout.tsx` sibling) doesn't
  distinguish it from any of the other 6 agreed sites, none of which have one either.
- **Convert `authorized-apps/page.tsx`'s single-action Disconnect to a `DropdownMenu`** — rejected: a
  menu around one item adds an interaction step with no grouping benefit.
- **FR-11 without a collateral-regeneration reconciliation clause** — rejected once confirmed
  `sidebar`'s registry dependencies regenerate already-customized `button.tsx`; added the same step
  FR-1 already uses.
- **FR-11's single-open-group Accordion behavior flattened to always-expanded** (implicit in the first
  FR-11 draft) — rejected in favor of reusing the already-vendored `ui/collapsible.tsx` (feature
  121/122), preserving existing UX with no new primitive.
- **FR-11's SSR mobile-detection flash deferred with no named mitigation** — rejected as insufficient
  for `design.md`; a concrete mitigation (CSS-gated trigger visibility, default-closed panel state) is
  named, with residual risk explicitly scoped to a verified-at-execute-time edge case.

## Open Risks

- [ ] FR-11's SSR/first-paint mobile-detection edge case (a click inside the sub-hydration window on a
      fresh mobile load) — mitigation named above; verify empirically via real-device/throttled-CPU
      check at `/sdd-spec`/execute time (Step 7).
- [ ] FR-9's chart-height conversion may net to zero code changes if all 3 sites are found coupled to
      `useCandlestickChart(N)` — acceptable per the FR's own qualifier; flagged so it isn't mistaken
      for incomplete work (Step 6).
- [ ] FR-4's "wide content scenario" per table is a judgment call deferred to execute-time grounding
      against each table's real column set — product-spec's own Open Question, not resolved here
      (Step 10).
- [ ] Cross-FR hot-file churn: `market/[symbol]/page.tsx` (FR-6/7/9/10), `positions/[symbol]/page.tsx`
      (FR-6/9/10), `orders/[id]/page.tsx` (FR-6/10) are each touched by multiple steps in sequence —
      `/sdd-spec` must ground later steps' citations fresh, not reuse this recon's pre-earlier-step
      line numbers (Steps 6, 8, 9).

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited steps) — honored by: every FR's citations were re-verified
  against the current `main-dev` working tree (post PR #917 merge) across 4 debate rounds, not carried
  forward from the original product-spec unverified; FR-8's broken `data-state` mechanism and the
  `tooltip.tsx`/`use-mobile` byproducts were both caught by direct source/registry reads, not assumed.
- `C-08`/`P-06` (test-pairing, red-before-green) — honored by: FR-11's new e2e coverage (none existed),
  FR-10's new `e2e/breadcrumb.spec.ts`, FR-5's added keyboard-activation tests, and every FR's existing
  e2e updated only for selector/interaction changes, never behavior changes, per `/sdd-execute`'s
  standard red/green gate at spec time.
- `C-10(a)` (nav-reachability across a shared surface) — honored by: FR-10's `aria-current`-based
  replacement assertion preserves the reachability guarantee for all 15 `nav-reachability.spec.ts`
  `GROUPS` routes, not just the 8 new `PageBreadcrumb` sites — resolved directly in response to Round
  4's adversary objection (see Rejected Alternatives).
- `C-12` (frontend test fixtures from the canonical inventory) — honored by: no new fixture module
  invented; existing `orders.ts`/`strategies.ts`/`configKeys.ts` reused where FR-2/FR-10's new e2e
  coverage needs domain data (`recon.md` Patterns to REUSE).
- `P-01`/`P-02` (single-orchestrator authority, mediated subagent exchange) — honored by: every
  proposer/adversary round was mediated by this session (never given each other's raw output); all
  writes (recon.md, product-spec.md amendments, context.md, this file) made by the orchestrator only.
- `P-03` (no silent deviation) — honored by: every ambiguity surfaced across 4 rounds (FR-10 site
  count, FR-11's SSR risk, the `data-state` mechanism) was escalated to explicit resolution, not
  guessed; the one genuine user-facing fork (FR-5's keyboard-accessibility direction) was put to the
  user directly via `AskUserQuestion` rather than decided silently.
- `P-04` (phase-gate approval, recorded) — honored by: the design.md write follows explicit user
  approval of the final Round 4 synthesis; `feature.md`/`context.md` record the transition.
- No `F-*` (Floor) breach anywhere across all 11 FRs, confirmed at the end of every round including
  this final consolidation (no direct `.up.sql` edit, no push to `main-dev`/`main`, no invented path,
  no step committed before its own verification, no file staged outside scope, no pre-Phase-2 write).
