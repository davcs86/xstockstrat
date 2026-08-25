# Design: watchlist-opportunity-signal-cues

**Created**: 2026-08-25
**Rounds**: 2 (quick mode, user opted into a 2nd round; termination: approved)
**Approved by**: user @ 2026-08-25
**Grounded in**: recon.md

---

## Chosen Approach

Five surgical, UI-only edits in `xstockstrat-ui`, built on **one shared state→cue derivation** so
firing/watching/quiet/no-data/in-queue is defined once and rendered identically on every surface. No
proto/config/DB change; consumer surfaces are `/insights` (Watchlists panel + Opportunities desktop &
mobile) and `/trader` (position-detail: SignalReadiness panel + breadcrumb) — all existing,
nav-reachable pages (C-14).

### FR-1 — shared color + icon cue (the DRY spine)

- **Single 4-way bucketer.** Promote `readinessState(r): ReadinessState`
  (`'firing'|'watching'|'quiet'|'nodata'`) as a new pure helper in
  `src/lib/readinessRollup.ts`, reusing `isFiring` (`readinessRollup.ts:11-13`). It becomes the
  **sole** source of the 4-way decision: `rollupReadiness` counts (`readinessRollup.ts:43-51`), the
  three `Progress` variant pickers (`WatchlistReadiness.tsx:41-46` `barVariant`,
  `opportunities/page.tsx:38-43` `readinessVariant`, `SectionRenderer.tsx:60-66` inline
  `readyVariant`), and the cue lookup all derive from it — collapsing the currently-duplicated
  branch logic rather than adding a 5th copy (recon "Do not re-derive per component",
  `recon.md` Patterns to REUSE; adversary round-2 DRY objection).
- **Render map** in `src/lib/opportunityShared.tsx`: extend `EnumRender` (`:14-17`) with
  `icon?: React.ComponentType<{ className?: string }>` (a component *reference* — keeps the map pure
  data, node-env unit-testable). Add `READINESS_CUE: Record<ReadinessState, EnumRender>` and a
  standalone `IN_QUEUE_CUE: EnumRender`. Widen `SemanticRole` (`:12`) with `'info'` — round-1
  adversary CONFIRMED safe: the four `Record<ProtoEnum, EnumRender>` maps (`:20-48`) gain no key, so
  `tsc` stays green and `Badge` already has an `info` variant (`badge.tsx:26`).
- **Icon rendering + test/a11y hook (FIX A).** `EnumBadge` (`:51-53`) renders the map's `icon` as a
  leading child; a small `CueIcon` wrapper stamps `data-testid={`readiness-cue-${state}`}` and
  `role="img"` + a **distinct** `aria-label` per state (Phosphor svgs have no accessible name by
  default — cf. `SectionRenderer.tsx:83`). Playwright asserts `row.getByTestId('readiness-cue-firing')`
  + the visible text; the unit test covers map *data* only.
- **Text carries state too (FIX B, AC-4).** Derive `stateLabel` (`WatchlistReadiness.tsx:56-60`)
  from `readinessState` via a `switch` so icon↔text can never diverge: firing→"firing",
  watching→dynamic `"N away"`, quiet→"quiet" (currently a 0-passing row wrongly reads "N away"),
  nodata→"no data". Icon is never the sole differentiator.
- **All four consumer surfaces** (C-10): `WatchlistReadiness.tsx` (state label `:226-237` + in-queue
  badge `:242-246`), `opportunities/page.tsx` `OpportunityRow`/`SymbolGroupCard` header
  (`:450,393-403`), the mobile signal renderer (`SectionRenderer.tsx:55-138`), and
  **`SignalReadiness.tsx`** "Why this fired" summary line (`:86-103`) — the user-confirmed 4th
  surface, covered by new scenario @AC-13.
- **Glyphs** (`@phosphor-icons/react ^2.1.7`, swappable in one place): firing=`Lightning` (fill),
  watching=`Eye`, quiet=`Moon`, nodata=`Question`, in-queue=`Stack`.

### FR-2 — firing-row jump

In the bound-row branch (`WatchlistReadiness.tsx:210-261`), render a `Link` to
`/trader/positions/${r.symbol}?strategy=${binding.strategyId}` guarded by `isFiring(r)`, beside
`BindingRowControls`, reusing the `reviewHref` shape (`opportunities/page.tsx:172-175`). Bound rows
always carry a strategyId (`bound = bindings.filter(b => b.strategyId)`, `:152`). Non-firing rows
render nothing (@AC-6). The link gets an explicit distinct `aria-label` (e.g. `Open ${symbol} detail`)
so it never collides with the symbol/CueIcon accessible names (adversary round-2).

### FR-3 — breadcrumb always Opportunities (user-mandated CHANGE)

The position-detail first crumb becomes `{ label: 'Opportunities', href: '/insights/opportunities' }`
**unconditionally** (`positions/[symbol]/page.tsx:377-380`) — "Exposure" is never the default, no
`?from` param threading. This is a deliberate behavior change (see Open Risks) chosen by the user.
Test scoping (FIX C, ledger 2026-08-09): the nav renders an "Opportunities" `Link` on every page
(`navGroups.tsx:46`), so AC-7/AC-8 assert **inside** `getByLabel('Position path')`; the existing
count-1 invariants (`breadcrumb.spec.ts:112-124`, keyed on the terminal `AAPL` crumb + the
"Position path" landmark) stay green because only the *first* crumb changes. Run a broad `-g`/full
breadcrumb+mobile scope before marking the step done.
> Nav-taxonomy note: Opportunities sits under the **Decide** group (not "Discover") in
> `navGroups.tsx:44-48`; the crumb links to `/insights/opportunities` regardless — destination is
> unambiguous.

### FR-4 — mobile Opportunities parity

Add a `signalGroup` section kind to `src/components/mobile/sections.ts`
(`{ kind:'signalGroup'; symbol; href; signals: SignalItem[] }` — no `count`, use `signals.length`)
and extend the `signal` fields with `strategyId?`, `chips?: string[]`, `expiry?: string`. Extract the
current `signal`-case body (`SectionRenderer.tsx:67-126`) into one shared `SignalRow` rendered by
**both** kinds (no orphaned duplicate), preserving the `mobile-muted-${symbol}` testid
(`SectionRenderer.tsx:74`) and the `mobile-sections` container. `signalGroup` renders a card whose
header mirrors `SymbolGroupCard` (`opportunities/page.tsx:393-403`). `mobileSections` becomes
`symbolGroups.map(...)` reusing `opportunityChips` (`:46-48`) + `expiresLabel` (`:61-65`). Re-run the
broader mobile spec.

### FR-5 — filter responsiveness (effective intersection, no mutating effect)

Compute `effectiveSources = activeSources.filter(s => sources.includes(s))` at render/filter time
(`opportunities/page.tsx:141` filter + the pill `aria-pressed`/active state), leaving stored
`activeSources` untouched so a vanished-then-returning source re-activates. **No `useEffect`** that
mutates `activeSources` (it would loop on the 15s `refetchInterval`, `useOpportunities.ts:21`, and
silently wipe the selection on a transient empty fetch). `actionFilter` needs no reconcile (static
options `:274-277`). "All sources" (`activeSources=[]` → `effectiveSources=[]` → all rows) is
unaffected.
- **Real RED (FIX D, ledger 074/080).** The bug requires the component to **stay mounted** while
  `sources` recomputes without the selected source. The e2e must drive fetch #2 **in place** — a
  window `focus` event (React Query `refetchOnWindowFocus`) or a manual `refetchQueries` — with a
  closure-counter `page.route` on `ListOpportunities` returning a shrunk source set on the 2nd fetch;
  **never `page.reload()`** (a reload remounts and resets `activeSources`, so the stuck state can
  never form and the test passes vacuously). Prove the assertion is RED on `main-dev` before the fix.

## Rejected Alternatives

- **FR-3 origin-aware crumb (round-1 design: `?from=opportunities`, else Exposure)** — rejected by
  the user in favor of the unconditional Opportunities crumb; preserves "back to where I came from"
  for non-Opportunities entry points but requires threading a param from every caller and keeps
  Exposure as a default the user does not want.
- **FR-5 prune `useEffect` mutating `activeSources`** — rejected: loops on the 15s refetch and
  silently discards the selection on a transient empty fetch (worse than the stuck symptom).
- **FR-5 RED via `page.reload()` payload swap** — rejected: reload remounts and resets state, so it
  reproduces nothing (vacuous green).
- **FR-1 parallel `readinessState` mirroring `rollupReadiness` buckets** — rejected: adds a 5th copy
  of the 4-way logic; consolidate into one bucketer instead (bigger diff, kills the divergence class).
- **FR-4 `head` + flat `signal` sections per symbol** — rejected: yields separate top-level rows, not
  AC-9's "single grouped card".
- **FR-1 wrapping the icon in `<span aria-label>`** — rejected: breaks the Badge `[&>svg]`
  direct-child icon-slot styling (`badge.tsx:8`).

## Open Risks

- [ ] **FR-3 navigational regression (deliberate, signed off).** The unconditional Opportunities
  crumb regresses back-navigation for Exposure/Portfolio/Orders/watchlist-jump entry points into
  `/trader/positions/[symbol]`. Nothing breaks in tests today (`position-detail.spec.ts:57-64` enters
  from Exposure but asserts no crumb). User chose this explicitly — recorded as a CHANGE in
  context.md. To revisit at the FR-3 step / review if UX objects.
- [ ] **Phosphor prop forwarding.** Assumes `@phosphor-icons/react` v2 forwards
  `role`/`aria-label`/`data-testid` to the underlying `<svg>`. If not, `data-testid` alone satisfies
  the Playwright assertion; the a11y name is the softer requirement. Verify at the FR-1 step.
- [ ] **Fixture additions.** `e2e/fixtures/opportunities.ts` likely needs a CAPR row pair
  (`quality-dip-buy` + `momentum`, source `watchlist`, expiry 14:30) + `READINESS_BUCKET_OVERRIDE`s
  for the firing/watching/quiet buckets (@AC-1/2/5/6/9/10). Confirm at the test steps (C-12/C-13).
- [ ] **Broad e2e scope for breadcrumb + mobile.** Per ledger 2026-08-09, run a broader `-g`/full
  suite (not just each step's own run) before marking the FR-3 and FR-4 steps done.

## Constitution Rules Touched

- **C-10** — all four readiness render surfaces updated + parity tests; SignalRow shared by both
  mobile kinds (no half-migrated surface).
- **C-11** — this design phase (story → design quick, +1 user round) satisfies the SDD grounding gate.
- **C-12 / C-13** — new/extended tests import domain data from `e2e/fixtures/` + `watchlistMock.ts`;
  fixture additions get an `INVENTORY.md` row.
- **C-14** — consumer surfaces named (`/insights` Watchlists + Opportunities, `/trader`
  SignalReadiness + breadcrumb); each earns its own step + test; @AC-13 added for the 4th surface.
- **C-15** — `acceptance.feature` updated: AC-7/AC-8 reworded for the unconditional crumb, @AC-13
  added for SignalReadiness; every FR covered.
- **P-03 / P-06 / C-08** — FR-5 reproduces the real defect (in-place refetch) with a proven RED; if
  after wiring the RED cannot be produced, record the finding rather than shipping a vacuous test.
- **F-01…F-11 (Floor)** — none breached: no migration edit, no direct push to protected branches, no
  invented path/symbol, no hardcoded config, no commit before verification.

## Business Rules Touched (C-16)

- None. No `services/xstockstrat-ui/acceptance/*.feature` suite exists yet and
  `docs/sdd/business-rules/platform.feature` holds no overlapping guarantee, so there is no promoted
  business rule to preserve/extend/change. Feature 155's own `acceptance.feature` is the sole guard.
