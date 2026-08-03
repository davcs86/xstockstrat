# Design: screener-watchlist-fidelity

**Approved**: 2026-08-02 (sdd-design Phase 1, quick mode + 1 user-requested extra round = 2 rounds)
**Lifecycle**: spec-ready → design-approved

---

## Chosen Approach

A presentation-and-existing-RPC-wiring change entirely within `services/xstockstrat-ui` (`/insights`
segment). **No proto / config / migration / new service.** Every value consumed already exists on the
wire. Build order is `src/lib` pure helpers (unit-tested) → Screener page → Screener→watchlist actions →
Watchlists master-detail → e2e.

### 1. Pure helpers in `src/lib/` (unit-tested; vitest coverage is scoped to `src/lib/**`)

- **`src/lib/screenWeights.ts`** — `normalizeWeights(weights: number[]): number[]` returns display
  shares that sum to 1.0. **Guards `sum <= 0`** (all-zero, reachable because the weight control allows 0)
  → returns equal shares (or `[]` for empty), never `NaN`/`Infinity`. Display-only: raw weights are still
  sent on the wire (FR-1; the analysis scorer normalizes server-side). Red-first vitest incl. the
  all-zero and single-criterion cases.
- **`src/lib/readinessRollup.ts`** — `isFiring(r): boolean` (`totalConditions > 0 && passingConditions
  === totalConditions`) and `rollupReadiness(readiness, requestedSymbols): { ready, watching, quiet,
  nodata }`. Buckets: `ready` = firing; `watching` = `passing > 0` but not all; `quiet` = `passing ===
  0 && total > 0`; **`nodata` = `total === 0`** (the honest mapping of the evaluator's
  `_empty_readiness` fallback — `services/xstockstrat-analysis/app/services/evaluator.py:191`,
  `app/handlers/servicer.py:1996-2003`). The count is **reconciled against the requested symbol set**:
  any requested symbol absent from the readiness array is also counted as `nodata`, so
  `ready+watching+quiet+nodata === requestedSymbols.length` holds **even if a future producer drops a
  symbol** (defends the AC-6 sum invariant beyond the mock's current 1:1 guarantee — 056/080 trap).
  Params are **structural** (`{ passingConditions: number; totalConditions: number }`), not the
  hook-inferred `Readiness` type, keeping the lib pure/unit-testable.
- **`src/lib/formatLastRun.ts`** — `formatLastRun(then: Date, now: number): string` → "last run 2m ago".
  Pure, **no `setInterval`**; the page passes `now = Date.now()` **at render** (not frozen in
  `onSuccess`), so the label freshens on any interaction. No live tick (How-to-Act #2 — minimalism); the
  cosmetic staleness of a perfectly idle post-scan page is documented, not a bug. Red-first vitest.
- `WatchlistReadiness.tsx` **imports `isFiring` from `readinessRollup.ts`** and deletes its local copy
  (`WatchlistReadiness.tsx:17`) — kills the DRY clone; `barClass`/`blockingCondition` stay (render-coupled).

### 2. Screener page (`src/app/insights/screener/page.tsx`)

- **Weight control** per criterion: a native `<input type="range" min=0 max=1 step=0.05>` **plus a
  bound `<Input type="number">`** sharing the same `weight` state (replaces the hardcoded `weight: 1` at
  `:39`; still sent raw at `:76`). The numeric input makes the AC-1/AC-2 e2e deterministic (Playwright
  cannot reliably `fill` a range input); the range gives the design's slider affordance. Normalized
  share printed beneath each row from `normalizeWeights` ("32% of weight" / "weights normalize to 1.0").
- **Hard/rank toggle**: a segmented two-`Button` control bound to `hardFilter` (replaces the bare
  checkbox at `:139`). No new `Switch`/`Toggle` primitive (none exists).
- **Criterion display grammar**: readable `<metric> <comparator> <threshold>` with editable fields,
  reusing the existing **partial** `COMPARATOR_LABELS` array (`:26-31`). **No typed
  `Record<Comparator, string>`** — `Comparator` has `UNSPECIFIED(0)` and `BETWEEN(5)`; an exhaustive map
  would fail `tsc` (fails.md 2026-07-21). `BETWEEN` stays omitted (it needs `threshold_high`, which the
  single-threshold grammar can't express — matches current behavior).
- **Score**: colored strength dot via `scoreColor` (`src/lib/scoreDisplay.ts:14`), replacing the inlined
  `>=0.8/>=0.7` thresholds at `:218` (DRY).
- **Last-run metadata**: store the completion `Date` in the mutation's `onSuccess` + the request symbol
  count in component state; render `formatLastRun(then, Date.now())` — "last run <rel> · <N> symbols".

### 3. Screener → watchlist actions

- **"Save as watchlist"** — inline name input → `useCreateWatchlist` seeded with the **passing subset**
  (`passed === true`) when any criterion has `hardFilter`, else **all** result symbols; the count is
  shown in the action label.
- **"Add top-N to watchlist"** — `useAddWatchlistSymbols` with the top-`N` ranked result symbols
  (`N = 5`, or all when fewer); target list picked via `Select` from `useWatchlists`.
- Both reuse the existing `useInvalidatingMutation`-based hooks (`useWatchlists.ts:21,53`).

### 4. Watchlists master-detail (`src/app/insights/watchlists/page.tsx` + one new component)

- `page.tsx` stays the client container: owns `selectedId` state (**init to first list; reconcile to
  first / null when the selected list is deleted or the set empties; `useCreateWatchlist.onSuccess`
  explicitly sets `selectedId` to the created list's id**), the create form, and the **master column**
  (each watchlist → a selectable row showing name + `symbols.length`).
- **One new component `src/components/insights/WatchlistDetail.tsx`** = the selected list's symbol-chip
  CRUD (add/remove/delete handlers moved from `page.tsx:35-50,117-154`), the **"Build from screener"**
  same-segment `/insights/screener` link, and the extended `<WatchlistReadiness>`. The selected list's
  **name is rendered as a heading here** (preserves the `getByRole('heading')` selector). `symbol-list`
  and `watchlist-readiness` `data-testid`s are preserved verbatim.
- **`useOpportunities` is called in `WatchlistDetail`** (above any early return; one poller for the
  selected list) → a `Set<string>` of **upper-cased** opportunity symbols, passed as an `inQueue` prop
  down to `WatchlistReadiness`. The membership check upper-cases the row symbol too (both sides
  normalized). This keeps `WatchlistReadiness` presentational and **sidesteps the hook-ordering hazard**
  of adding a hook after `WatchlistReadiness.tsx:48`'s `return null`.
- **`WatchlistReadiness` extended in place**: the "N ready · N watching · N quiet[ · N no-data]"
  roll-up and the per-row states both derive from the **one** `useReadiness` result (C-10(b)); a row
  with `total === 0` renders "no data" (not "0 away"); a single **"Evaluated against: `<strategy>`"
  caption** shows the chosen strategy (**not** a per-row STRATEGY column — user-approved 2026-08-02);
  rows show the `inQueue` mark. Readiness stays strategy-scoped via the existing picker (`:59`).

### 5. Tests

- **Unit**: `src/lib/{screenWeights,readinessRollup,formatLastRun}.test.ts` (red-first), extending the
  existing `src/lib/*.test.ts` layout.
- **E2E**: extend `e2e/insights/screener.spec.ts` (weight sent ≠ 1, hard/rank toggle, last-run text,
  save/add-to-watchlist) and `e2e/insights/watchlists.spec.ts` (master-detail selection, roll-up
  `ready+watching+quiet+nodata === symbols.length`, caption, in-queue, Build-from-screener link,
  create auto-selects). Vary readiness buckets by **spreading overrides at the mock handler call site**
  — `evaluateReadiness` returns `{ ...symbolReadiness(sym), ...bucketOverride[sym] }` — so
  `symbolReadiness(symbol)` **stays single-arg** (no point-free `.map` `tsc` break; the shared 083
  signal-detail AAPL default is unchanged). No LAST/CHG/Quotes UI exists to assert against (deferred).

## Rejected Alternatives

- **Radix `Slider` primitive for weight** — rejected: none exists; adding a dependency for one control
  violates minimalism (How-to-Act #2). Native range + numeric input covers affordance and testability.
- **Per-row STRATEGY column** (literal FR-10/AC-6) — rejected by user 2026-08-02: repeats one strategy
  name on every row and visually re-implies the per-symbol signal→strategy binding feature 083 forbids.
  The single caption is honest and simpler; AC-6/FR-10 wording relaxed to "the readiness view shows the
  evaluated strategy".
- **Fold `total===0` into `quiet`** — rejected: mislabels an un-evaluable symbol (transient marketdata
  failure) as "none close to firing". The `nodata` bucket is the honest mapping and is what makes the
  AC-6 sum invariant hold.
- **Parameterize the shared `symbolReadiness(symbol, overrides)` fixture** — rejected: breaks the
  point-free `e2e/mock-backend.ts:491` `.map(symbolReadiness)` (`.map` passes the index as arg 2) and
  risks the 083 signal-detail specs. Spreading overrides at the call site is lower-risk.
- **Live relative-time tick (`setInterval`)** for last-run — rejected: speculative scaffolding; render
  once from `Date.now()` at render time.
- **Persisted per-list default strategy** (to show per-list "N ready" on every master row without a
  picker) — rejected: a new DB column, out of scope; would also encode a per-list strategy binding.
  The roll-up shows for the selected list + chosen strategy only.

## Open Risks (carried to context.md Open Threads)

- **R1 — Producer 1:1 assumption.** Both adversary rounds verified `EvaluateReadiness` appends one
  `SymbolReadiness` per requested symbol (`servicer.py:1996-2003`). The rollup nonetheless reconciles
  against the **requested symbol set** so a future producer that drops symbols still keeps the sum
  invariant. Target: helper `rollupReadiness` (step 1) + the AC-6 e2e assertion (step 5).
- **R2 — In-queue case/symbol normalization.** `.toUpperCase()` covers case only; symbol-notation
  variants (`BRK.B` vs `BRK-B`) would still miss. Acceptable — both current sources are upper-case
  canonical. Target: `WatchlistDetail`/`WatchlistReadiness` (step 4).
- **R3 — Last-run staleness on a perfectly idle page.** By design (no tick). Documented; e2e asserts the
  static string. Target: `formatLastRun` (step 1) + screener page (step 2).
- **R4 — Master/detail e2e selectors.** Extraction must preserve `symbol-list` / `watchlist-readiness`
  testids and the list-name heading, and create must auto-select. Target: step 4 + step 5.

## Constitution Rules Touched

- **C-10(a)** — no new route (Screener/Watchlists already registered in the Discover nav group,
  `navGroups.tsx:44-46`); the new "Build from screener" / "Save as watchlist" cross-links resolve to
  registered hrefs, asserted in e2e.
- **C-10(b)** — the readiness roll-up count and the per-row states derive from the **one**
  `useReadiness` result; master count vs. detail sum reconciled via the requested-symbol-set denominator.
- **C-12 / C-13** — tests reuse the centralized `e2e/mock-backend.ts` handlers and the
  `e2e/fixtures/opportunities.ts` `symbolReadiness` fixture (kept single-arg); no parallel mock.
- **P-03 / F-04** — every symbol/path cited is grep-verified; nothing invented.
- **Floor** — no breach: no migration (F-01), no direct-DB pool change (F-06), no hardcoded config
  value (F-07). N=5 / step=0.05 / min-conviction are UI display constants, not `WatchConfig` keys.
