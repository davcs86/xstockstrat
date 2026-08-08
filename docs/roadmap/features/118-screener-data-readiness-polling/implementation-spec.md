# Implementation Spec: screener-data-readiness-polling

**Status**: `pending`
**Created**: 2026-08-08
**Feature**: `docs/roadmap/features/118-screener-data-readiness-polling/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/screener-data-readiness-polling`

---

## Execution Summary

**Re-spec note (2026-08-08, conditional re-spec per sequential-mode §5.3 — evidence only, no logic
change):** every `page.tsx` line-number citation below was re-verified and corrected against the
current file after `117-screener-fundamental-metric-selector` (a different, already
`code-completed` feature that independently claimed number `117`, resolved by renumbering this
feature to `118` — see `merge-order.md` and `context.md`) landed on `main-dev` and shifted lines by
inserting a `Select` dropdown for the Fundamental-kind metric field. That feature's change and this
one are in disjoint regions of the file (its edit is inside the criterion-row rendering block; this
spec's Steps 2/3 touch state management, the results derivation, and the results-table/banner JSX)
— no step's actual instructions or code changed, only the `path:line` citations that had drifted.

Three steps, all in `xstockstrat-ui` (`/insights/screener`), no other service touched — matching
design.md's "No proto, servicer, or `xstockstrat-analysis` engine changes" conclusion. Step 1 adds a
poll-capable sibling hook (`useScreenSymbolsPoll`) plus two cadence constants to
`src/hooks/useScreenSymbols.ts`. Step 2 wires that hook into `src/app/insights/screener/page.tsx`:
`results` becomes explicit `useState`, a scan-generation counter guards against a stale poll response
from a superseded scan, and a "Checking… / Stop checking / Gave up" affordance renders next to the
existing PR #902 pending banner. Step 3 adds Playwright coverage for all six acceptance criteria using
Playwright's Clock API (`page.clock`) to fast-forward the 60s cadence instead of waiting on it for real.

**Implementation decisions made in this spec that design.md left open** (recorded here per
Constitution P-03 — not silent):

1. **Cadence constants live in the hook file, not colocated with `TOP_N` in `page.tsx`.**
   Design.md's precedent citation ("colocate with `TOP_N`") is about `TOP_N` being a plain-TS,
   non-config constant — not literally about file placement. `POLL_INTERVAL_MS` is consumed inside
   `useScreenSymbolsPoll`'s own `refetchInterval` callback (`useScreenSymbols.ts`); defining it in
   `page.tsx` and importing it into the hook file would invert the normal hook→page dependency
   direction. Both constants are exported from the hook file; `page.tsx` imports `MAX_POLL_ATTEMPTS`
   only, for its "attempt N of 5" label.
2. **The first re-check fires immediately when polling becomes enabled, counted as attempt 1 of 5**
   (not delayed 60s). TanStack Query fetches immediately when a query with no cached data becomes
   `enabled` (Context7 `/tanstack/query/v5.90.3`, "Important Defaults > Automatic Refetching" +
   `refetchInterval` migration-guide snippets — confirmed, not assumed). Avoiding this would need
   `initialData`/`initialDataUpdatedAt` seeding from the mutation's own response, which is materially
   more code for a cadence-precision gain design.md itself only commits to approximately ("~5 minutes
   total ceiling"). Total real polling span with this choice: ~4 minutes (1 immediate + 4 more spaced
   60s apart, capped at 5 total).
3. **The attempt cap counts failed fetches too** (`query.state.dataUpdateCount +
   query.state.errorUpdateCount`, both fields confirmed present on `QueryState` via Context7 —
   `/tanstack/query`, `packages/query-core/src/query.ts` source snippet), not `dataUpdateCount` alone.
   `dataUpdateCount` only increments on a successful fetch; a persistently-erroring poll (network
   blip, backend down) would never hit a cap based on it alone, silently violating FR-4 ("never poll
   indefinitely"). Paired with `retry: false` on the poll query so one scheduled tick = one real
   network attempt, not up to 4 (TanStack's default retry count) — keeping design.md's Open Risk 3
   mitigation ("the cap bounds this to a small, fixed number") honest.
4. **`refetchOnWindowFocus`/`refetchOnReconnect`/`refetchOnMount` are all explicitly `false`** on the
   poll query. TanStack Query's own documented default behavior (Context7, same "Important Defaults"
   page: "Stale queries are refetched automatically … when the window is refocused") would otherwise
   let a user tabbing away and back re-trigger a fetch outside the `refetchInterval` schedule,
   bypassing the attempt cap — the same class of gap as #3, just via a different trigger.

## Step Dependencies

- Step 2 requires Step 1: `page.tsx` imports `useScreenSymbolsPoll`/`MAX_POLL_ATTEMPTS` from
  `useScreenSymbols.ts`.
- Step 3 [test] covers Steps 1 + 2 [service]: red observed against the pre-Step-1 tree (no
  `screener-checking`/`stop-polling`/`screener-polling-gave-up` testids exist, no second
  `ScreenSymbols` call is ever issued), green after both service steps land.

---

### Step 1 — service: add the poll-capable sibling hook to `useScreenSymbols.ts`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useScreenSymbols.ts` — modify

**Reviewers**: xstockstrat-ui — Trading UI correctness, analytics display accuracy, config mutation
safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no
direct DB access (except audit log)

**Codebase Evidence**:
- Current file in full (17 lines): `useMutation`-based `useScreenSymbols()`, `ScreenSymbolsInput`/
  `ScreenSymbolsResult` types derived via `Parameters<>`/`Awaited<ReturnType<>>` (not exported today)
  — `services/xstockstrat-ui/src/hooks/useScreenSymbols.ts:1-17`.
- Reuse pattern (recon.md, confirmed): `useBackfillStatus`'s terminal-state
  `refetchInterval: (query) => { const status = query.state.data?.status; return status !== undefined
  && isTerminal(status) ? false : 4000; }` — `services/xstockstrat-ui/src/hooks/useBackfills.ts:35-45`.
- Proto fields confirmed unchanged: `ScreenResultStatus.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA = 2` →
  TS `ScreenResultStatus.INSUFFICIENT_DATA` (already imported/used in `page.tsx:28,157`);
  `ScreenResult.gap`, `ScreenResult.symbol` — `packages/proto/analysis/v1/analysis.proto:351-403`.
- `@tanstack/react-query` pinned at `5.100.14` (resolved) — `pnpm-lock.yaml:1981,1984`; `package.json`
  declares `"@tanstack/react-query": "^5.62.0"` (`services/xstockstrat-ui/package.json:37`).
- `refetchInterval` callback signature `(query: Query<...>) => number | false | undefined` and
  `QueryState.dataUpdateCount` / `QueryState.errorUpdateCount` fields, confirmed via Context7
  `/tanstack/query` (source: `packages/query-core/src/query.ts` — "`dataUpdateCount` is incremented
  on successful fetch (case 'success'). `errorUpdateCount` on fetch failure (case 'error')").
- `retry` option precedent already used in this codebase:
  `services/xstockstrat-ui/src/hooks/useStrategies.ts:34,64` (`retry: (failureCount, err) => ...`).
- No config key needed — `analysis.screener.*` keys unaffected
  (`services/xstockstrat-analysis/CLAUDE.md` "Config Keys Consumed"); this constant is deliberately a
  plain TS value per design.md § Chosen Approach (Cadence/attempts), following the `TOP_N` precedent
  (`services/xstockstrat-ui/src/app/insights/screener/page.tsx:62-64`).

**TDD**: `red-green required` (paired with Step 3's tests — see Step Dependencies)

**Instructions**:

1. Export the two existing type aliases (currently module-private) so `page.tsx` (Step 2) can use
   them:
   ```ts
   export type ScreenSymbolsInput = Parameters<typeof analysisClient.screenSymbols>[0];
   export type ScreenSymbolsResult = Awaited<ReturnType<typeof analysisClient.screenSymbols>>;
   ```
2. Add the import `import { ScreenResultStatus } from '@xstockstrat/proto/analysis/v1/analysis_pb';`
   (matches the import already used in `page.tsx:28`) and `useQuery` alongside the existing
   `useMutation` import.
3. Add a **module-private** helper (not exported — single internal consumer):
   ```ts
   function hasPendingRows(results: ScreenSymbolsResult['results'] | undefined): boolean {
     return (results ?? []).some((r) => r.status === ScreenResultStatus.INSUFFICIENT_DATA);
   }
   ```
4. Add the two exported cadence constants, matching design.md's concrete values ("poll every 60s, cap
   at 5 attempts … fixed, no backoff"):
   ```ts
   export const POLL_INTERVAL_MS = 60_000;
   export const MAX_POLL_ATTEMPTS = 5;
   ```
5. Add `useScreenSymbolsPoll`:
   ```ts
   export function useScreenSymbolsPoll(
     req: ScreenSymbolsInput | null,
     generation: number,
     enabled: boolean,
   ) {
     return useQuery<ScreenSymbolsResult, Error>({
       queryKey: ['screen-symbols-poll', generation],
       queryFn: () => analysisClient.screenSymbols(req!),
       enabled: enabled && req !== null,
       retry: false,
       refetchOnWindowFocus: false,
       refetchOnReconnect: false,
       refetchOnMount: false,
       refetchIntervalInBackground: false,
       refetchInterval: (query) => {
         const data = query.state.data;
         if (data && !hasPendingRows(data.results)) return false;
         const attempts = query.state.dataUpdateCount + query.state.errorUpdateCount;
         if (attempts >= MAX_POLL_ATTEMPTS) return false;
         return POLL_INTERVAL_MS;
       },
     });
   }
   ```
   Note the `queryKey` includes `generation` — this **is** the scan-generation guard design.md calls
   for: when Step 2 bumps `generation` on a new `runScan()`, this hook call gets a brand-new query
   cache entry, so a still-in-flight fetch from the superseded generation resolves into a cache entry
   nothing reads anymore (the component only ever subscribes to the current generation's key).
6. Leave `useScreenSymbols()` and its `onError` behavior untouched.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
cd services/xstockstrat-ui && pnpm run lint
```
Both must pass with no new errors. `useScreenSymbolsPoll`/`hasPendingRows` are unused at this point
(Step 2 wires the call site) — `tsc --noEmit` doesn't flag unused exports, so this is a type-safety
check only; Step 3's tests are what prove the behavior.

---

### Step 2 — service: wire background polling into the Screener page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: xstockstrat-ui — Trading UI correctness, analytics display accuracy, config mutation
safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no
direct DB access (except audit log)

**Codebase Evidence**:
- Current `useScreenSymbols()` call + `runScan()` (builds the request inline as `.mutate()`'s first
  arg) — `services/xstockstrat-ui/src/app/insights/screener/page.tsx:83,114-146`.
- Current `results` derivation `const results = screen.data?.results ?? [];` and pending-row
  derivation `pendingFundamentals` — `page.tsx:148-158`.
- Existing pending banner (PR #902) to place the new affordance beside —
  `page.tsx:451-459`.
- Existing per-row status badge (already reads `r.status`/`r.gap` reactively from `results` — no
  change needed here; it "self-updates" once `results` state updates from a merge) —
  `page.tsx:521-539`.
- `TOP_N` UI-constant precedent (comment: "not a WatchConfig key, Floor F-07 unaffected") —
  `page.tsx:62-64`.
- `Button` component with `variant="secondary"` already used for a similar secondary action
  ("save-as-watchlist") — `page.tsx:416-424`.

**TDD**: `red-green required` (paired with Step 3's tests — see Step Dependencies)

**Instructions**:

1. Add `useEffect` to the existing `'use client'; import { useState } from 'react';` line (→
   `import { useEffect, useState } from 'react';`).
2. Change the `useScreenSymbols` import line (`page.tsx:18`) to also pull in the Step-1 additions:
   ```ts
   import {
     useScreenSymbols,
     useScreenSymbolsPoll,
     MAX_POLL_ATTEMPTS,
     type ScreenSymbolsInput,
     type ScreenSymbolsResult,
   } from '@/hooks/useScreenSymbols';
   ```
3. Add a module-level merge helper near the existing `comparatorGlyph`/`newCriterion` helpers
   (`page.tsx:66-80`):
   ```ts
   // Feature 118: merges a poll response into the displayed results by symbol, preserving row order
   // (avoids the table visibly reordering every 60s) — safe because every poll response is a full,
   // correctly-normalized result set for the identical symbol+criteria universe, not a partial one to
   // reconcile (design.md § Chosen Approach — full-scan recheck, never narrowed).
   function mergeResultsBySymbol(
     current: ScreenSymbolsResult['results'],
     incoming: ScreenSymbolsResult['results'],
   ): ScreenSymbolsResult['results'] {
     const bySymbol = new Map(incoming.map((r) => [r.symbol, r]));
     return current.map((r) => bySymbol.get(r.symbol) ?? r);
   }
   ```
4. In the component, replace the `lastRun` state block (`page.tsx:90-92`) area by adding four more
   `useState` declarations alongside it:
   ```ts
   const [results, setResults] = useState<ScreenSymbolsResult['results']>([]);
   const [scanGeneration, setScanGeneration] = useState(0);
   const [lastScanReq, setLastScanReq] = useState<ScreenSymbolsInput | null>(null);
   const [pollingEnabled, setPollingEnabled] = useState(true);
   const [pollAttempts, setPollAttempts] = useState(0);
   ```
5. Delete the old line `const results = screen.data?.results ?? [];` (`page.tsx:148`) — replaced by
   the `results` state above.
6. Move the pending-row derivation (`page.tsx:149-158`) to right after the new state block (before
   `runScan()`, since the poll hook call in the next sub-step needs `pendingRows` in scope), and
   broaden it per FR-3 (both `INSUFFICIENT_DATA` causes drive polling; `pendingFundamentals` stays
   the narrower subset the existing banner text is specific to):
   ```ts
   // INSUFFICIENT_DATA has two distinct causes the backend already tells apart (see
   // services/xstockstrat-analysis/app/services/screener.py): too few bars for a technical
   // criterion (carries a `gap`) vs. the fundamentals data source being unavailable (no `gap`).
   // Both drive the background auto-recheck uniformly (feature 118, FR-3).
   const pendingRows = results.filter((r) => r.status === ScreenResultStatus.INSUFFICIENT_DATA);
   const pendingFundamentals = pendingRows.filter((r) => !r.gap);
   ```
7. Immediately after that, add the poll hook call and its merge effect:
   ```ts
   const poll = useScreenSymbolsPoll(
     lastScanReq,
     scanGeneration,
     pollingEnabled && lastScanReq !== null && pendingRows.length > 0,
   );

   useEffect(() => {
     // Increment on EITHER a successful poll response or a failed one (network/RPC error) — must
     // mirror the hook's own attempt-counting (dataUpdateCount + errorUpdateCount, Step 1 §5) or a
     // poll that keeps erroring would correctly stop polling internally while this page-level
     // counter stays frozen at 0, leaving the UI stuck on "Checking…" forever instead of flipping
     // to "Gave up" (spec review caught this before execution — see context.md).
     if (poll.data === undefined && poll.error === undefined) return;
     if (poll.data !== undefined) {
       setResults((prev) => mergeResultsBySymbol(prev, poll.data!.results));
     }
     setPollAttempts((n) => n + 1);
   }, [poll.data, poll.error]);
   ```
8. Update `runScan()` (`page.tsx:114-146`) to capture the request object, reset per-scan polling
   state, and seed `results`/`lastScanReq` on success:
   ```ts
   function runScan() {
     const symbols = symbolsText.split(/[\s,]+/).filter(Boolean);
     if (symbols.length === 0) return;
     const req: ScreenSymbolsInput = {
       symbols,
       criteria: criteria.map((c) => {
         const base = {
           refName: c.refName,
           kind: c.kind,
           op: c.op,
           threshold: c.threshold,
           weight: c.weight,
           hardFilter: c.hardFilter,
         };
         if (c.kind === ScreenKind.TECHNICAL_INDICATOR) {
           return {
             ...base,
             component: {
               refName: c.refName,
               kind: ComponentKind.BUILTIN_INDICATOR,
               indicator: c.metricName.toUpperCase(),
             },
           };
         }
         return { ...base, metricName: c.metricName };
       }),
     };
     // Feature 118 — scan-generation guard: bump before mutate so a still-in-flight poll from a
     // superseded scan is orphaned; reset per-scan polling state so a stopped/exhausted previous
     // scan's status never leaks into the new one (closes the "stale permanent opt-out" gap).
     setScanGeneration((g) => g + 1);
     setLastScanReq(null);
     setPollAttempts(0);
     setPollingEnabled(true);
     screen.mutate(req, {
       onSuccess: (data) => {
         setLastRun({ at: new Date(), count: symbols.length });
         setResults(data.results);
         setLastScanReq(req);
       },
     });
   }
   ```
9. In the JSX, inside the existing `{!screen.isPending && results.length > 0 && (<> ... </>)}` block
   (`page.tsx:391-461`), immediately after the existing `pendingFundamentals` banner
   (`page.tsx:451-459`) and still inside the same fragment, add the checking/stop/gave-up affordance
   (FR-6):
   ```tsx
   {pendingRows.length > 0 && pollingEnabled && pollAttempts < MAX_POLL_ATTEMPTS && (
     <div
       data-testid="screener-checking"
       className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
     >
       <span>
         Checking for updated data… (attempt {Math.min(pollAttempts + 1, MAX_POLL_ATTEMPTS)} of{' '}
         {MAX_POLL_ATTEMPTS})
       </span>
       <Button
         size="sm"
         variant="secondary"
         data-testid="stop-polling"
         onClick={() => setPollingEnabled(false)}
       >
         Stop checking
       </Button>
     </div>
   )}
   {pendingRows.length > 0 && pollingEnabled && pollAttempts >= MAX_POLL_ATTEMPTS && (
     <p data-testid="screener-polling-gave-up" className="mb-2 text-sm text-muted-foreground">
       Gave up checking — {pendingRows.length} of {results.length} symbols are still not
       available. Run the scan again later to retry.
     </p>
   )}
   ```
   No change is needed to the results-table badge JSX (`page.tsx:521-539`) — it already reads
   `r.status`/`r.gap` from each row of `results`, so a merged-in resolved row renders the "OK" badge
   automatically.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
cd services/xstockstrat-ui && pnpm run lint
```
Both must pass. Behavioral proof is Step 3's Playwright suite (a `tsc`/lint pass alone doesn't prove
the polling/merge/cap behavior — see the red-green pairing in Step Dependencies).

---

### Step 3 — test: Playwright coverage for background data-readiness polling

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — modify (append a new `test.describe`
  block)
- `services/xstockstrat-ui/e2e/fixtures/screenResults.ts` — new (C-12 fixture centralization, see
  Codebase Evidence)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (move "Screener results" from "Not
  yet centralized" to the canonical fixtures table, same commit as the new fixture file)

**Reviewers**: xstockstrat-ui — Trading UI correctness, analytics display accuracy, config mutation
safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no
direct DB access (except audit log)

**Codebase Evidence**:
- Existing file structure, imports, and the closure-capture per-test mock pattern to extend —
  `services/xstockstrat-ui/e2e/insights/screener.spec.ts:1-23` (`mockScreen` helper),
  `:54-81` (single-route-override pattern used for the fundamentals-pending case).
- **Confirmed absent** (recon.md Risks, verified by direct grep): no stateful/call-counted mock
  exists anywhere in `e2e/mock-backend.ts` (`callCount`/`let call`/`callsByKey` → zero hits); the
  global `screenSymbols` handler is fully stateless/deterministic —
  `services/xstockstrat-ui/e2e/mock-backend.ts:709-753`. This step's new tests need their own local
  `page.route` closure counter — that part stays inline (matches the existing per-file convention;
  the *counter/sequencing logic* has no fixture home and isn't domain data).
- **C-12 correction from impl-spec review**: the *domain data itself* (the `ScreenResult` row
  shapes) is a different question from the counter logic above, and does have a fixture-inventory
  trigger — `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` ("Not yet centralized" table) lists
  **"Screener results | `e2e/mock-backend.ts` (`screenSymbols`)"** verbatim. Per
  `docs/patterns/test-data-inventory.md` Rule 3, a feature that substantially touches a domain
  listed there centralizes it in the same step, regardless of consumer count — this step defines 3+
  `ScreenResult`-shaped scenario rows (fundamentals-pending, bars-insufficient, resolved), several
  structurally identical to the literal already inline at `screener.spec.ts:67`. Fixture-module
  precedent to follow (single-arg scenario-row factories, not static objects, since `symbol` varies
  per test): `services/xstockstrat-ui/e2e/fixtures/backtests.ts:47-60`
  (`insufficientDataResult(strategyId, symbols, range)` factory pattern) and
  `services/xstockstrat-ui/e2e/fixtures/orders.ts` (`orderForId` single-arg factory,
  per `INVENTORY.md`'s Orders row).
- Pinned test runner: `"@playwright/test": "1.59.1"` — `services/xstockstrat-ui/package.json:56`.
- **New pattern for this repo** (not previously used anywhere under `e2e/` — confirmed via grep, zero
  hits for `page.clock`): Playwright's Clock API, confirmed via Context7 `/microsoft/playwright/v1.58.2`
  (`docs/src/clock.md`) — `page.clock.install()` (call before `page.goto`) virtualizes the page's
  timers so `setTimeout`/`setInterval`-driven code (including TanStack Query's internal
  `refetchInterval` scheduling) can be advanced without a real wait; `page.clock.fastForward(ms)`
  "jumps forward in time, firing due timers at most once" per call. Used here to advance the 60s
  cadence deterministically instead of a 4–5-minute real-time Playwright test. **Important scope
  limit** (impl-spec review finding): `page.clock` virtualizes the *page's* timers only — it does
  **not** control how fast a mocked `page.route` handler resolves in real Node time. The immediate
  first poll (Execution Summary decision #2) is not gated by any page timer at all, so its real
  resolution speed is a genuine race against Playwright's assertions unless the mock route
  deliberately delays it — see the `mockScreenSequence` design in Instructions §1 below.
- `data-testid`s this step asserts on, all added by Step 2: `screener-checking`, `stop-polling`,
  `screener-polling-gave-up`; existing testids reused: `fundamentals-pending`, `insufficient-data`,
  `screen-results`, `run-screen` — `page.tsx:522-537` (existing), Step 2 Instructions §9 (new).

**TDD**: `red-green required`. Run this suite against the tree from before Step 1/2 (or comment out
Steps 1–2's changes) first — `screener-checking`/`stop-polling`/`screener-polling-gave-up` will never
appear (they don't exist yet) and the call-count assertions will show exactly one `ScreenSymbols`
call ever, proving red. After Steps 1–2 land, re-run for green.

**Instructions**:

0. Create `services/xstockstrat-ui/e2e/fixtures/screenResults.ts` (single-arg factories, matching
   the `backtests.ts`/`orders.ts` precedent — see Codebase Evidence):
   ```ts
   /**
    * Canonical ScreenResult scenario rows for the Screener e2e suite.
    *
    * Shape source: `xstockstrat.analysis.v1.ScreenResult`
    * (packages/proto/analysis/v1/analysis.proto). `status: 2` is
    * `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA`; `status: 1` is `SCREEN_RESULT_STATUS_OK`. A `gap`
    * distinguishes the two pending causes the Screener UI tells apart (feature 118 design.md):
    * absent → fundamentals-pending; present → bars-insufficient.
    *
    * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
    */

   /** A pending row whose fundamentals data source is unavailable (no `gap`). */
   export function fundamentalsPendingRow(symbol: string) {
     return { symbol, score: 0, passed: false, status: 2 };
   }

   /** A pending row with too few bars for a technical criterion (carries a `gap`). */
   export function barsInsufficientRow(symbol: string) {
     return {
       symbol,
       score: 0,
       passed: false,
       status: 2,
       gap: { symbol, timeframe: 4, barsHave: '0', barsNeed: '2' },
     };
   }

   /** A resolved (OK) row with an explicit score/criterionScores. */
   export function resolvedRow(symbol: string, score: number, criterionScores?: Record<string, number>) {
     return { symbol, score, passed: true, status: 1, criterionScores: criterionScores ?? { c1: score } };
   }
   ```
   Update `INVENTORY.md`: move the existing "Screener results | `e2e/mock-backend.ts`
   (`screenSymbols`)" row out of "Not yet centralized" and add it to the canonical fixtures table
   (same row shape as the other entries): `Screener results | fundamentalsPendingRow,
   barsInsufficientRow, resolvedRow | e2e/fixtures/screenResults.ts |
   xstockstrat.analysis.v1.ScreenResult | e2e/insights/screener.spec.ts (feature 118 polling suite)`.
   The `mock-backend.ts` global `screenSymbols` handler's own inline rows are unaffected — only
   *new* scenario rows in this step use the fixtures; C-12 doesn't require retrofitting the
   pre-existing global mock.
1. Append a new `test.describe('Screener — background data-readiness polling (feature 118)', () =>
   { ... })` block to the end of `screener.spec.ts`, after the existing
   `test.describe('Screener', ...)` block closes, importing the three factories from Step 0. Inside
   it, a local stateful mock helper (file-scoped to this `describe`, not exported — matches the
   existing `mockScreen` convention at the top of the file):
   ```ts
   import { fundamentalsPendingRow, barsInsufficientRow, resolvedRow } from '../fixtures/screenResults';

   // Every response after the first (i.e. every poll attempt — including the immediate one that
   // fires the instant polling is enabled, which page.clock does NOT gate; see Codebase Evidence)
   // is delayed `delayMs` in real Node time. This is what makes the "still checking" transient
   // state deterministically observable by Playwright's assertions instead of racing a
   // near-instant mocked round trip (impl-spec review finding).
   function mockScreenSequence(
     page: Page,
     responses: Array<Record<string, unknown>>,
     delayMs = 150,
   ) {
     const state = { calls: 0 };
     const routed = page.route(
       '**/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols',
       async (route) => {
         const call = state.calls;
         state.calls += 1;
         if (call > 0) await new Promise((r) => setTimeout(r, delayMs));
         const body = responses[Math.min(call, responses.length - 1)];
         route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
       },
     );
     return { routed, state };
   }
   ```
2. **Test — resolves live (AC-1 start condition, AC-2, AC-4 visible-checking half):**
   `await page.clock.install();` before `page.goto`. Mock a 2-response sequence via
   `mockScreenSequence`: response 1 = `{ results: [fundamentalsPendingRow('AAA')], coverageGaps: [] }`;
   response 2 = `{ results: [resolvedRow('AAA', 0.8)], coverageGaps: [] }`. Run the scan; assert
   `fundamentals-pending`, `screener-checking`, and `stop-polling` are all visible (the 150ms delay
   on the immediate poll's response gives this a reliable window — see Instructions §1).
   `await page.clock.fastForward(60_000);` (the exported `POLL_INTERVAL_MS` value — hardcode `60_000`
   in the test with a comment citing the constant, since e2e specs don't import service internals).
   Assert `fundamentals-pending` and `screener-checking` both have count 0, and `state.calls === 2`.
3. **Test — caps at 5 attempts and shows an honest "gave up" state (AC-3 cap half):** mock a
   single always-pending response (`[fundamentalsPendingRow('AAA')]`, repeats via `Math.min(...)`
   clamping) via `mockScreenSequence`. Run the scan; assert `screener-checking` visible.
   `await page.clock.fastForward(60_000);` **four** times (the immediate first check + 4 more spaced
   ticks = 5 total poll attempts, per this spec's Execution Summary decision #2). Assert
   `screener-polling-gave-up` is visible, `screener-checking` has count 0, and `state.calls === 6`
   (1 initial scan + 5 poll attempts).
4. **Test — "Stop checking" halts further attempts (AC-4 stop half):** same always-pending mock. Run
   the scan; wait for `screener-checking` visible; capture `state.calls` into `callsAtStop`; click
   `stop-polling`; assert `screener-checking` has count 0. `await page.clock.fastForward(5 * 60_000);`
   (well past the cadence); assert `state.calls === callsAtStop` (no further network calls after
   stopping).
5. **Test — fundamentals-pending and bars-insufficient resolve independently (AC-5):** mock a
   3-response sequence via `mockScreenSequence`: response 1 =
   `{ results: [fundamentalsPendingRow('AAA'), barsInsufficientRow('BBB')], coverageGaps: [] }`;
   response 2 = `{ results: [resolvedRow('AAA', 0.8), barsInsufficientRow('BBB')], coverageGaps: [] }`;
   response 3 = `{ results: [resolvedRow('AAA', 0.8), resolvedRow('BBB', 0.6)], coverageGaps: [] }`.
   Run the scan; assert `fundamentals-pending` and `insufficient-data` both visible.
   `fastForward(60_000)` once; assert `fundamentals-pending` count 0, `insufficient-data` still
   visible, `screener-checking` still visible (BBB still pending). `fastForward(60_000)` again;
   assert `insufficient-data` count 0 and `screener-checking` count 0. `state.calls === 3`.
6. **Test — a scan with zero `INSUFFICIENT_DATA` rows never starts checking (AC-1 second half):**
   reuse the existing top-of-file `mockScreen(page, {})` helper (all-OK, no pending row). Run the
   scan; assert `screener-checking` has count 0 both immediately and after
   `fastForward(5 * 60_000)`.
7. **Test — navigating away and back starts fresh, with no residual polling status (AC-6):** mock a
   single always-pending response (`mockScreenSequence`, `[fundamentalsPendingRow('AAA')]`). Run the
   scan; assert `screener-checking` visible. `page.goto('/insights/watchlists')` then
   `page.goto('/insights/screener')`; assert both `screener-checking` and `screen-results` have
   count 0 (component remounted, all local state reset — no scan, no results, no polling;
   consistent with the stateless-scan contract, FR-7/AC-6).
8. **Test — an erroring poll (not just a still-pending response) still gives up honestly at the cap
   (regression guard for a defect caught during impl-spec review, see context.md):** a dedicated
   local helper (same file, mirrors `mockScreenSequence`'s delay treatment so the same race
   consideration applies):
   ```ts
   function mockScreenInitialThenErroring(page: Page, initialBody: Record<string, unknown>, delayMs = 150) {
     const state = { calls: 0 };
     page.route('**/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols', async (route) => {
       const call = state.calls;
       state.calls += 1;
       if (call === 0) {
         route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(initialBody) });
         return;
       }
       await new Promise((r) => setTimeout(r, delayMs));
       route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
     });
     return state;
   }
   ```
   Mock the *initial* scan as `{ results: [fundamentalsPendingRow('AAA')], coverageGaps: [] }` (call
   0, undelayed), then every poll attempt (call ≥ 1) 500s after the delay. Run the scan; assert
   `screener-checking` visible showing "attempt 1 of 5" (reliable now — the delay keeps
   `pollAttempts` at 0 until well after this assertion runs, unlike the undelayed race the review
   flagged). `await page.clock.fastForward(60_000);` four times. Assert `screener-polling-gave-up`
   is visible and `screener-checking` has count 0 — proving the page-level `pollAttempts` counter
   advances on a **failed** poll exactly like a successful-but-still-pending one (the `poll.error`
   branch added to the Step 2 §7 `useEffect`), not just frozen at "attempt 1".

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test insights/screener.spec.ts
```
All 7 new tests (Instructions §2–§8; §0–§1 are fixture/helper setup, not tests themselves) pass,
and all pre-existing tests in `screener.spec.ts` (**12** as of the re-spec — `main-dev` gained 2
more from `117-screener-fundamental-metric-selector` since this count was first written; re-confirmed
via `grep -c "^\s*test("`) continue to pass unmodified — proving AC-6's "no regression to the
existing PR #902 badge/banner behavior." No coverage threshold applies to `xstockstrat-ui` (Next.js — e2e-only per
`.claude/skills/sdd-spec/reference/spec-template.md` § Test step pairing rule coverage table);
this Playwright run is the required verification.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
