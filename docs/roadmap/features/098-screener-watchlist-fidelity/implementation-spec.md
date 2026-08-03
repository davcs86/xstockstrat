# Implementation Spec: screener-watchlist-fidelity

**Status**: `done`
**Created**: 2026-08-02
**Feature**: `docs/roadmap/features/098-screener-watchlist-fidelity/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/screener-watchlist-fidelity`

---

## Execution Summary

Entirely within `services/xstockstrat-ui` (`/insights` segment) — presentation + existing-RPC wiring,
**no proto / config / migration / new service** (product spec § Proto/Config/Database Changes all
"No"). Build order follows the design's `src/lib`-first sequence so the pure logic is unit-tested
(vitest coverage is scoped to `src/lib/**`) before the pages consume it: (1) pure helpers +
(2) their unit tests, then (3) Screener display, (4) Screener→watchlist actions, (5) Watchlists
master-detail, and (6) one e2e step covering the three UI steps against the centralized mock backend.

**Consumer surface (C-14):** the only named surface is **UI `/insights`** — the Screener
(`/insights/screener`) and Watchlists (`/insights/watchlists`) pages, both already registered in the
Discover nav group (`navGroups.tsx:45-46`), so no new route and no `PLATFORM_SUBNAV` addition is
needed (C-10(a)); Steps 3–5 land the change on that surface and Step 6 proves it. The deferred
surface (live LAST / intraday CHG % / Quotes tab) points at the **named follow-up feature
`099-watchlist-live-quotes`** (C-14 override recorded in `context.md`), not a vague "later".

## Step Dependencies

- **Step 2 [test] covers Step 1 [service]** — the vitest unit tests for the three `src/lib` helpers
  (red-before-green, P-06); Step 1's helpers must exist for Step 2 to import.
- **Step 4 requires Step 3** — both edit `src/app/insights/screener/page.tsx`; Step 4's
  save/add-to-watchlist actions build on the criterion/result state Step 3 leaves in place.
- **Step 5 requires Step 1** — `WatchlistReadiness.tsx` and the rollup consume
  `src/lib/readinessRollup.ts` (`isFiring`, `rollupReadiness`) created in Step 1.
- **Step 6 [test] covers Steps 3, 4, and 5** — this is a **frontend** service (no per-service
  coverage threshold; e2e coverage applies, per `reference/spec-template.md` test-threshold table),
  so the three UI `service` steps are proven by the single Playwright e2e step rather than paired
  coverage steps. Step 6's assertions are authored **red-first** against the pre-implementation tree.
- **Deferred surface** — live LAST / CHG % / Quotes tab is out of scope here and tracked by the
  named follow-up feature `099-watchlist-live-quotes`; Step 6 asserts the **absence** of those
  surfaces (AC-8).

---

### Step 1 — service: pure `src/lib` helpers (weights, readiness rollup, last-run) + DRY `isFiring`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/screenWeights.ts` — create
- `services/xstockstrat-ui/src/lib/readinessRollup.ts` — create
- `services/xstockstrat-ui/src/lib/formatLastRun.ts` — create
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify (import `isFiring` from the new helper, delete the local copy)

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy, derived-value parity (C-10(b)), DRY guard rail (no duplicated `isFiring`)

**Codebase Evidence**:
- Existing local `isFiring` to delete: `WatchlistReadiness.tsx:17-18` — `const isFiring = (r: Readiness) => r.totalConditions > 0 && r.passingConditions === r.totalConditions;` (used at `:46`, `:85` via `barClass`, `:92`, `:95`).
- The evaluator's degenerate-row fallback that `nodata` maps to (`total === 0`): confirmed in recon.md / design.md against `services/xstockstrat-analysis/app/services/evaluator.py:191` and `app/handlers/servicer.py:1996-2003` (1:1 append of one `SymbolReadiness` per requested symbol, `_empty_readiness` fallback yields `totalConditions === 0`).
- `src/lib` is the unit-testable home (vitest `coverage.all: false`, scope `src/lib/**`) — existing peers: `src/lib/scoreDisplay.ts`, `positionRisk.ts`, `protoTime.ts`, `equityCurve.ts`, `copilot.ts`, `chart.ts` (each with a `.test.ts`).

**TDD**: `red-green required` (paired test is Step 2)

**Instructions**:
1. `src/lib/screenWeights.ts` — export `normalizeWeights(weights: number[]): number[]` returning display shares that sum to 1.0. **Guard `sum <= 0`** (all-zero is reachable — the weight control allows 0): return equal shares (`1/n` each) for a non-empty all-zero input, and `[]` for an empty input. Never emit `NaN`/`Infinity`. Display-only — callers still send raw weights on the wire (FR-1).
2. `src/lib/readinessRollup.ts` — export:
   - `isFiring(r: { passingConditions: number; totalConditions: number }): boolean` = `r.totalConditions > 0 && r.passingConditions === r.totalConditions`. Parameter type is **structural** (not the hook-inferred `Readiness`), keeping the module pure/unit-testable.
   - `rollupReadiness(readiness: Array<{ symbol: string; passingConditions: number; totalConditions: number }>, requestedSymbols: string[]): { ready: number; watching: number; quiet: number; nodata: number }`. Buckets: `ready` = `isFiring`; `watching` = `passingConditions > 0` but not all; `quiet` = `passingConditions === 0 && totalConditions > 0`; `nodata` = `totalConditions === 0`. **Reconcile against the requested set**: any `requestedSymbols` entry with no matching `readiness` row also counts as `nodata`, so `ready + watching + quiet + nodata === requestedSymbols.length` holds even if a future producer drops a symbol (R1; defends AC-6 beyond the mock's 1:1 guarantee).
3. `src/lib/formatLastRun.ts` — export `formatLastRun(then: Date, now: number): string` → e.g. `"last run 2m ago"`. Pure; **no `setInterval`** (R3 — the page passes `now = Date.now()` at render, not frozen in `onSuccess`). Handle the sub-minute case ("just now" / "last run <1m ago" — pick one and unit-test it).
4. In `WatchlistReadiness.tsx`: delete the local `isFiring` (`:17-18`) and `import { isFiring } from '@/lib/readinessRollup';` (kills the DRY clone that jscpd would otherwise flag). Leave `barClass`/`blockingCondition` (render-coupled) in place — `barClass` keeps calling the now-imported `isFiring`.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
```
- `pnpm run build` (tsc) confirms `WatchlistReadiness.tsx` still type-checks against the imported `isFiring`.
- Behavioral proof is Step 2 (`pnpm run test:coverage`).

---

### Step 2 — test: vitest unit tests for the three `src/lib` helpers (red-first)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/screenWeights.test.ts` — create
- `services/xstockstrat-ui/src/lib/readinessRollup.test.ts` — create
- `services/xstockstrat-ui/src/lib/formatLastRun.test.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy, derived-value parity (C-10(b))

**Codebase Evidence**:
- Unit-test layout to mirror: `src/lib/scoreDisplay.test.ts:1` (`import { describe, it, expect } from 'vitest';`), which imports the SUT from `'./scoreDisplay'` and uses `it.each` — same pattern for these three files.
- Coverage config: this service's CLAUDE.md § Testing — vitest scoped to `src/lib/**`, `coverage.all: false`, **40%** threshold on files a unit test exercises; run `pnpm run test:coverage`.
- C-13 test-data: these are pure numeric/date helpers (no domain proto objects), so inline literals are compliant — no fixture-home move needed (single-purpose scenario inputs).

**TDD**: `red-green required` — author the assertions to **fail** against the pre-Step-1 tree (the helper modules don't exist yet), then pass after Step 1.

**Instructions**:
1. `screenWeights.test.ts` — assert `normalizeWeights` on: a mixed vector sums to 1.0 and preserves ratios; the **all-zero** case returns equal shares (no `NaN`); the **single-criterion** case returns `[1]`; the empty case returns `[]`.
2. `readinessRollup.test.ts` — assert `isFiring` true only when `total > 0 && passing === total`; `rollupReadiness` buckets each of ready/watching/quiet/nodata; a `total === 0` row lands in **`nodata`, not `quiet`**; and the **sum invariant** `ready+watching+quiet+nodata === requestedSymbols.length` holds both when readiness covers every requested symbol **and** when a requested symbol is missing from the readiness array (extra `nodata`).
3. `formatLastRun.test.ts` — assert the relative-time string for a couple of fixed `(then, now)` deltas (e.g. 120_000ms → `"last run 2m ago"`) and the sub-minute branch chosen in Step 1.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage
```
- Confirm all three suites pass and the `src/lib` coverage threshold (40%) still passes with the new files exercised.

---

### Step 3 — service: Screener display (weight control, hard/rank toggle, grammar, last-run, score dot)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy, Connect-RPC call safety (weight/hard_filter sent, not hardcoded), no secret values rendered

**Codebase Evidence**:
- `weight` hardcoded to `1`: `screener/page.tsx:40` (`weight: 1,` inside `newCriterion`); still sent raw at `:76` (`weight: c.weight,` in `runScan`'s `criteria.map`). The wire field `ScreenCriterion.weight` already exists (product spec § Proto — field 8).
- Bare `hard` checkbox to replace: `page.tsx:138-146` (`<input type="checkbox" aria-label="hard filter" ...>` + `hard` label), bound to `hardFilter` via `updateCriterion(i, { hardFilter: ... })`.
- Partial comparator label array to reuse for the grammar: `COMPARATOR_LABELS` at `page.tsx:26-31` (`LT '<'`, `LTE '<='`, `GT '>'`, `GTE '>='`). **Do not** build an exhaustive `Record<Comparator, string>` — `Comparator` includes `UNSPECIFIED(0)` and `BETWEEN(5)`; an exhaustive map would fail `tsc` (fails.md 2026-07-21). `BETWEEN` stays omitted (needs `threshold_high`, which the single-threshold grammar can't express).
- Inlined score thresholds to replace with `scoreColor`: `page.tsx:216-219` (`r.score >= 0.8 ? 'text-buy' : r.score >= 0.7 ? 'text-primary' : ''`). Canonical helper: `src/lib/scoreDisplay.ts:14` `scoreColor(score)` (`>=0.8 text-buy` / `>=0.6 text-paper` / else `text-destructive`) — reuse it (DRY, C-10).
- `Slider` primitive is **absent** (recon Risk — `src/components/ui/slider*` not found); use a native `<input type="range">` + the existing `<Input type="number">` (`page.tsx:9` imports `Input` from `@/components/ui/input`). No new dependency (How-to-Act #2).
- No `Switch`/`Toggle` primitive exists — build the hard/rank toggle from two existing `Button`s (`page.tsx:8` imports `Button`).
- The mutation to hang last-run off: `useScreenSymbols` (`page.tsx:10,45`, `screen.mutate` at `:67`, `screen.data` at `:81`); `useScreenSymbols` wraps `analysisClient.screenSymbols` (`src/hooks/useScreenSymbols.ts:9-11`).

**TDD**: `red-green required` — UI behavior is proven by the Playwright e2e in Step 6 (frontend service, no jsdom component tests per this service's CLAUDE.md § Testing); Step 6's screener assertions are authored red-first.

**Instructions**:
1. **Weight control (FR-1):** per criterion row, add a native `<input type="range" min={0} max={1} step={0.05}>` **and** a bound `<Input type="number">` sharing the same `weight` state via `updateCriterion(i, { weight: Number(...) })`. Keep sending the **raw** weight at `:76` (unchanged). Beneath each row print the normalized share from `normalizeWeights(criteria.map(c => c.weight))` (Step 1) — e.g. `"32% of weight"` with a `"weights normalize to 1.0"` caption. The numeric input keeps the AC-1 e2e deterministic (Playwright cannot reliably `fill` a range input).
2. **Hard/rank toggle (FR-2):** replace the `:138-146` checkbox with a segmented two-`Button` control bound to `hardFilter` (`hard` = excludes on fail; `rank` = contributes to score only). Toggling still calls `updateCriterion(i, { hardFilter })`; the value flows to the wire at `:76` (unchanged `hardFilter: c.hardFilter`).
3. **Criterion display grammar (FR-3):** render each row as a readable `<metric> <comparator> <threshold>` (e.g. `rsi_14 ≤ 70`) using the existing `COMPARATOR_LABELS` for the operator glyph, with the fields still editable (metric `<Input>`, comparator `<select>`, threshold `<Input type="number">` all preserved) and the normalized weight caption beneath.
4. **Score dot (FR-7):** replace the inlined ternary at `:216-219` with `scoreColor(r.score)` from `src/lib/scoreDisplay.ts` and render the design's colored strength dot alongside the numeral.
5. **Last-run metadata (FR-4):** in `useScreenSymbols`'s `onSuccess`, store the completion `Date` and the request's symbol count in component state; render `formatLastRun(then, Date.now())` at render (Step 1) as `"last run <rel> · <N> symbols"`. No live tick (R3).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
```
- `pnpm run build` confirms no exhaustive-`Record<Comparator,...>` was introduced (tsc-clean) and `scoreColor` import resolves. Behavioral proof: Step 6.

---

### Step 4 — service: Screener → watchlist actions (Save as watchlist, Add top-N)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Connect-RPC call safety, analytics display accuracy, no fabricated bindings

**Codebase Evidence**:
- Existing watchlist mutation hooks to reuse (all built on `useInvalidatingMutation`, invalidating `['watchlists']`):
  - `useCreateWatchlist` — `src/hooks/useWatchlists.ts:21-31`, accepts `{ name; description?; symbols? }` and calls `insightsPortfolioClient.createWatchlist({ name, description, symbols })`.
  - `useAddWatchlistSymbols` — `useWatchlists.ts:53-59`, accepts `{ watchlistId; symbols }` → `insightsPortfolioClient.addWatchlistSymbols(input)`.
  - `useWatchlists` — `useWatchlists.ts:10-19` (to populate the target-list picker) → `listWatchlists`.
- Result shape available on the page: `screen.data?.results` (`page.tsx:81`); each result has `symbol`, `passed` (`page.tsx:183,238`), and `score` (score-ordered by the backend — recon; mock returns score-descending, `mock-backend.ts:634-672`).
- `insightsPortfolioClient` (browser client bound to `/insights/api`): `src/lib/browserClients/insightsPortfolioClient.ts` (confirmed present).
- `Select` primitive present for the target-list picker (recon § UI primitives present — `src/components/ui/select`).
- Header propagation: these hooks call the **existing** `insightsPortfolioClient` / `insightsBff` which already forwards `x-user-id`/`x-access-scope`/`x-trace-id`; **no new outbound gRPC call path is introduced** (the client + BFF already propagate — root CLAUDE.md § Auth+BFF, `bffShared.ts` `backendHeaders`). Watchlist ownership is scoped server-side by `x-user-id` (`useWatchlists.ts:9` comment).

**TDD**: `red-green required` — proven by Step 6's screener e2e (save/add-to-watchlist assertions), authored red-first.

**Instructions**:
1. **Save as watchlist (FR-5):** add an inline name `<Input>` + action that calls `useCreateWatchlist` seeded with the **passing subset** (`results.filter(r => r.passed).map(r => r.symbol)`) when any criterion has `hardFilter === true`, else **all** result symbols. Show the seeded count in the action label (e.g. `"Save 2 as watchlist"`). Prompt for the name via the inline input (no `window.prompt`).
2. **Add top-N to watchlist (FR-6):** add an action calling `useAddWatchlistSymbols` with the top-`N` ranked result symbols (`N = 5` default; all when fewer than N). Choose the target list via a `Select` populated from `useWatchlists()`.
3. `N = 5` and the passing-subset rule are **UI display constants**, not `WatchConfig` keys (Floor F-07 unaffected — confirmed in design § Constitution Rules Touched).
4. Do not fabricate any signal→strategy binding — these actions only move symbols; readiness/strategy stays out of the screener (feature 083 rule).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
```
- Behavioral proof: Step 6 (create seeded from screener; add-top-N to a chosen list).

---

### Step 5 — service: Watchlists master-detail + readiness rollup/caption/in-queue

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — create
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy, derived-value parity (C-10(b)), no fabricated signal→strategy binding, nav reachability (C-10(a)) for the Build-from-screener link

**Codebase Evidence**:
- Current flat-stack page to restructure: `watchlists/page.tsx` — CRUD handlers `handleCreate` (`:29-33`), `handleAddSymbol` (`:35-45`), `handleDelete` (`:47-50`); the `.map` of `<Card>` cards (`:96-160`); the per-list `data-testid="symbol-list"` (`:117`) and the `<WatchlistReadiness symbols={wl.symbols} />` render (`:156`). Hooks imported at `:9-16` (`useWatchlists`, `useCreateWatchlist`, `useDeleteWatchlist`, `useAddWatchlistSymbols`, `useRemoveWatchlistSymbols`). List name rendered as `<h2>` heading (`:102`) — the e2e selector `getByRole('heading', { name })` (`watchlists.spec.ts:84,100`).
- `WatchlistReadiness` current shape: strategy picker via `useStrategyDefinitions` (`:41`, aria-label `"Readiness strategy"` at `:60`); `useReadiness(strategyId, symbols)` (`:44`); `readyCount = readiness.filter(isFiring)` headline (`:46,55-57`); per-row list sorted by conviction (`:74-104`), `away = totalConditions - passingConditions` (`:77`), `firing / N away` (`:95`), `blockingCondition` (`:99`), `data-testid="watchlist-readiness"` (`:51`). Returns `null` when `symbols.length === 0` (`:48`).
- `useOpportunities` for the in-queue mark: `src/hooks/useOpportunities.ts:14-20` (polls `analysisClient.listOpportunities({ minConviction })` every 15s); `Opportunity.symbol` is the field (product spec § Proto). `useReadiness` also lives here (`:23-29`).
- Same-segment link target: `/insights/screener` is registered in the Discover nav group (`navGroups.tsx:46`); base path `BASE_PATH_INSIGHTS = '/insights'` (`src/lib/basepath.ts:2`) — a plain `/insights/screener` href suffices (recon § Cross-segment link; no new base path).
- Rollup/`isFiring` helpers from Step 1: `src/lib/readinessRollup.ts` (`rollupReadiness`, `isFiring`).

**TDD**: `red-green required` — proven by Step 6's watchlists e2e (master-detail selection, rollup sum, caption, in-queue, Build-from-screener, create auto-select), authored red-first.

**Instructions**:
1. **Master-detail (FR-8):** in `watchlists/page.tsx`, keep it the client container and add `selectedId` state — **init to the first list; on delete or empty, reconcile to the first remaining / `null`; on `useCreateWatchlist.onSuccess` set `selectedId` to the created list's id** (R4 — create auto-selects). Render a **master column** (each watchlist → a selectable row showing `name` + `symbols.length`) and the selected list's `<WatchlistDetail>`. Preserve the create form (`:65-84`).
2. **New `WatchlistDetail.tsx` (FR-8/FR-11/FR-12):** move the selected list's symbol-chip CRUD (add/remove/delete handlers, the `data-testid="symbol-list"` chip block, the add-symbol input) out of `page.tsx:35-50,117-154` into this component. Render the list **name as an `<h2>` heading** here (preserve the `getByRole('heading')` selector). Add the **"Build from screener"** link → plain `<a href="/insights/screener">` (or the app's `Link`) — same-segment, resolves to the registered route (C-10(a)). Call **`useOpportunities()` here, above any early return** (one poller for the selected list), build a `Set<string>` of **upper-cased** opportunity symbols, and pass it as an `inQueue` prop into `<WatchlistReadiness>`. Keep `symbol-list` and `watchlist-readiness` `data-testid`s verbatim.
3. **Extend `WatchlistReadiness.tsx` (FR-9/FR-10/FR-11):** accept the new `inQueue?: Set<string>` prop. Replace the `readyCount` headline (`:46`) with the full **`"<N> ready · <N> watching · <N> quiet[ · <N> no-data]"`** rollup computed by `rollupReadiness(readiness, symbols)` (Step 1) — the rollup **and** the per-row states both derive from the **one** `useReadiness` result (C-10(b); the sum reconciles to the requested `symbols` set — R1). For a row with `totalConditions === 0`, render **"no data"** (not `"0 away"`). Add a single **"Evaluated against: `<strategy>`"** caption above the rows (the chosen strategy's `displayName`) — **not** a per-row STRATEGY column (user-approved 2026-08-02, design § Rejected Alternatives). Mark a row whose upper-cased symbol is in `inQueue` as **"in queue"**. Readiness stays strategy-scoped via the existing picker (`:59`) — no persisted per-list strategy, no fabricated binding.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
```
- `pnpm run build` confirms the `WatchlistDetail` extraction preserves types and the `inQueue` prop threads cleanly; behavioral proof: Step 6.

---

### Step 6 — test: e2e for Screener + Watchlists derivable surfaces (extend centralized mock; assert LAST/CHG/Quotes absent)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (readiness bucket overrides only, existing RPC fields)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog the `symbolReadiness` reuse + new consumer)

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy, derived-value parity (C-10(b)), test-data inventory (C-12)

**Codebase Evidence**:
- Screener e2e to extend: `e2e/insights/screener.spec.ts` (feature-060/083 specs, `data-testid` selectors `run-screen`, `screen-results`, `result-row`, `insufficient-data`).
- Watchlists e2e to extend: `e2e/insights/watchlists.spec.ts` — stateful `mockWatchlists(page)` via `page.route('**/…PortfolioService/{ListWatchlists,CreateWatchlist,AddWatchlistSymbols,RemoveWatchlistSymbols,DeleteWatchlist}')` (`:15-71`); the readiness test at `:106-126` already drives the strategy picker (`getByLabel('Readiness strategy')`, option `"Live Test Strategy"`) and asserts `"1 away"`.
- Central mock handlers (analysis RPCs are global, **not** per-spec): `evaluateReadiness` at `mock-backend.ts:490-492` (`(req.symbols.length ? req.symbols : ['AAPL']).map(symbolReadiness)`); `listOpportunities` at `:485-488` (filters `OPPORTUNITIES`); `listStrategyDefinitions` at `:678-683` (returns `STRATEGY_DEFINITIONS`).
- Shared readiness fixture: `symbolReadiness(symbol)` at `e2e/fixtures/opportunities.ts:58-84` (single-arg; `passingConditions: 2, totalConditions: 3` → `"1 away"`). Imported by mock-backend at `mock-backend.ts:41`. **Keep it single-arg** — the `.map(symbolReadiness)` call site passes the array index as arg 2; parameterizing it breaks that and risks the 083 signal-detail specs (design § Rejected Alternatives). Vary buckets by **spreading overrides at the handler call site**: `{ ...symbolReadiness(sym), ...bucketOverride[sym] }`.
- In-queue source symbols: `OPPORTUNITIES` = AAPL, MSFT, TSLA, NVDA (`e2e/fixtures/opportunities.ts:10-55`) — a watchlist containing AAPL yields an "in queue" row.
- Strategy option name for the picker: `STRATEGY_DEF_LIVE.displayName === 'Live Test Strategy'` (`e2e/fixtures/strategies.ts:55`).
- INVENTORY current state: the `Opportunity queue` row (`INVENTORY.md:21`) lists only `OPPORTUNITIES` for `e2e/fixtures/opportunities.ts` — `symbolReadiness` (already exported and mock-consumed) is **not** catalogued; add it and the new `watchlists.spec.ts` consumer in this step (C-12 catalog upkeep).

**TDD**: `red-green required` — author every new assertion to **fail** against the pre-Steps-3/4/5 tree (no weight control, no rollup caption, etc.), then pass after those steps. Run red before, green after.

**Instructions**:
1. **Screener (covers Steps 3–4):** assert (a) editing a criterion weight to ≠ 1 sends that weight on the wire (intercept `**/AnalysisService/ScreenSymbols` and assert the request `criteria[0].weight !== 1`); (b) the hard/rank toggle flips the sent `hardFilter`; (c) the last-run text `"last run … · N symbols"` renders after a scan; (d) "Save as watchlist" seeds a new list from results and "Add top-N" adds top-N to a chosen list (drive against `mockWatchlists`-style portfolio routes, reusing the watchlists spec's mock pattern or a shared helper).
2. **Watchlists (covers Step 5):** assert master-detail selection (select a list → its detail + `symbol-list` shows), the rollup `"<N> ready · <N> watching · <N> quiet[· <N> no-data]"` whose counts **sum to the requested symbol count** (AC-6), the single **"Evaluated against: …"** caption (no per-row STRATEGY column), an AAPL row marked **"in queue"**, the **"Build from screener"** link resolves to `/insights/screener`, and **create auto-selects** the new list. Use a `bucketOverride` in `mock-backend.ts`'s `evaluateReadiness` to give distinct symbols distinct buckets (including a `{ passingConditions: 0, totalConditions: 0 }` → **no-data** symbol) so the rollup exercises all four buckets.
3. **Deferred-surface guard (AC-8):** assert **no** LAST price, intraday CHG %, or Quotes tab UI is present on Watchlists (these belong to `099-watchlist-live-quotes`).
4. **Mock discipline (C-12/C-13):** extend `mock-backend.ts` only with **already-defined** RPC fields (readiness `passingConditions`/`totalConditions`/`conditions`, opportunity `symbol`) — no invented fields. Keep `symbolReadiness` single-arg. Update `INVENTORY.md`: add `symbolReadiness` to the `e2e/fixtures/opportunities.ts` row and list `e2e/insights/watchlists.spec.ts` (readiness buckets) as a consumer.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm exec playwright test e2e/insights/screener.spec.ts e2e/insights/watchlists.spec.ts
```
- Confirm the new screener + watchlists assertions pass; confirm `grep -n "from '../fixtures'\|helpers/auth\|symbolReadiness" e2e/insights/watchlists.spec.ts e2e/mock-backend.ts` shows the centralized fixture/auth imports (no inline parallel mock), and `INVENTORY.md` carries the updated Opportunity-queue row.

---

## Deviation Log

- **2026-08-02 — single-branch execution (harness mandate).** All 6 steps were implemented directly on
  the harness-assigned branch `claude/ui-revamp-low-fidelity-ii5p1h` as one change set (not per-step
  feature branches / PRs), because the session's operating mandate is "all work on the designated
  branch, one PR to `main`." The red-before-green discipline and per-step verification were still
  honored (unit tests written with the helpers; e2e authored to exercise the new surfaces).
- **2026-08-02 — Steps 3 + 4 landed in one `screener/page.tsx` rewrite.** Both steps edit the same
  file and Step 4 builds on Step 3's state; they were applied together. No scope change.
- **2026-08-02 — shared `e2e/helpers/watchlistMock.ts` extracted.** Step 6 needed the portfolio
  watchlist mock in `screener.spec.ts` too, so `mockWatchlists` was lifted out of `watchlists.spec.ts`
  into a shared helper (DRY) and both specs import it. INVENTORY.md updated: the Watchlists mock moved
  from "Not yet centralized" to the canonical fixtures table.
- **2026-08-02 — create-auto-select race fix (`pendingSelectRef`).** Setting `selectedId` directly in
  `useCreateWatchlist.onSuccess` raced the `ListWatchlists` refetch: the reconcile effect saw the new
  id "not in the list yet" and clobbered it back to the first list (caught by the master-detail e2e).
  Fixed by deferring selection via a `pendingSelectRef` that selects the new list only once it appears
  in the refetched set. R4 in design.md.
- **Verification (2026-08-02):** `pnpm build` ✓, `pnpm lint` ✓ (only a pre-existing warning in
  `strategies/[id]/page.tsx`), `pnpm test:coverage` ✓ (55 unit tests; `screenWeights`/`readinessRollup`/
  `formatLastRun` at 100%), `playwright test e2e/insights` ✓ (79 passed), DRY `check-duplication.sh
  services/xstockstrat-ui/src` ✓ (0 clones).
