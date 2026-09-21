# Implementation Spec: sparkline-ohlc-replacement

**Status**: `pending`
**Created**: 2026-09-11
**Feature**: `docs/roadmap/features/188-sparkline-ohlc-replacement/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/sparkline-ohlc-replacement`

---

## Execution Summary

This is a UI-only feature replacing sparkline bar charts with OHLC text on two pages. The
implementation proceeds bottom-up: pure utility functions and types first (Step 1), then their
unit tests (Step 2), then the hook refactor (Step 3), new component (Step 4), two consumer-page
swaps (Steps 5–6), the shared Sparkline deletion (Step 7), and finally E2E test updates (Step 8).
This order ensures each layer is stable before its consumers are wired. No proto, backend,
config, or migration changes are required — all work is in `xstockstrat-ui`.

Consumer surfaces: `/insights` (Opportunities List) and `/trader` (symbol detail page) — both
addressed by Steps 5 and 6 respectively (C-14).

## Scenario Coverage

- AC-1 → Steps 5, 8
- AC-2 → Steps 6, 8
- AC-3 → Steps 2, 3
- AC-4 → Steps 2, 8
- AC-5 → Steps 7, 8

## Step Dependencies

- Step 2 requires Step 1: unit tests import `fmtShortDate` and `selectOhlcBar` added in Step 1
- Step 3 requires Step 1: hook uses `OhlcData` type and `selectOhlcBar` from `protoTime.ts`
- Step 4 requires Step 1: component uses `OhlcData` type and `fmtShortDate` from `protoTime.ts`
- Step 5 requires Steps 3 and 4: opportunities page imports `useOhlcBars` hook and `OhlcBlock` component
- Step 6 requires Steps 3 and 4: symbol detail page imports `useOhlcBars` hook and `OhlcBlock` component
- Step 7 requires Steps 5 and 6: shared `Sparkline.tsx` can only be deleted after both consumers are removed
- Step 8 requires Steps 5, 6, and 7: E2E tests verify the final integrated behavior

---

### Step 1 — service: Add fmtShortDate, OhlcData, and selectOhlcBar to protoTime.ts

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/protoTime.ts` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: existing `timestampToDate` and `timestampToMillis` at `src/lib/protoTime.ts:11-18`
- Confirmed via: vitest coverage scoped to `src/lib/**` (`vitest.config.ts:25`) — placing the pure functions here makes them unit-testable within the existing coverage scope
- Confirmed via: design.md §3 — `fmtShortDate` in `protoTime.ts` with `timeZone: 'UTC'`; design.md §1 — `OhlcData` type in the hook file (but the type definition itself lives here to avoid inverted dependency; the hook re-exports it)
- Confirmed via: design.md §2 — skip-today guard uses UTC date comparison on both sides

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Add the `OhlcData` type after the existing `timestampToDate` function:
   ```ts
   export type OhlcData = { date: Date; open: number; high: number; low: number; close: number };
   ```

2. Add `fmtShortDate` utility:
   ```ts
   export function fmtShortDate(d: Date): string {
     return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
   }
   ```
   The `timeZone: 'UTC'` is mandatory — daily `Bar.time` is stored as UTC midnight; without it,
   negative-UTC-offset browsers render the date one day off (design.md §3).

3. Add `selectOhlcBar` pure helper that implements the skip-today guard:
   ```ts
   export function selectOhlcBar(
     bars: ReadonlyArray<{ time?: ProtoTimestamp; open: number; high: number; low: number; close: number }>,
     now?: Date,
   ): OhlcData | undefined {
     if (bars.length === 0) return undefined;
     const today = now ?? new Date();
     const todayUtc = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;
     // Bars are ascending chronological; most recent is last.
     for (let i = bars.length - 1; i >= 0; i--) {
       const d = timestampToDate(bars[i].time);
       if (!d) continue;
       const barUtc = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
       if (barUtc === todayUtc) continue; // Skip partially-formed today bar
       return { date: d, open: bars[i].open, high: bars[i].high, low: bars[i].low, close: bars[i].close };
     }
     return undefined;
   }
   ```
   The `now` parameter enables deterministic testing with vitest (node-environment, no DOM).

**Verification**:
```bash
cd services/xstockstrat-ui && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```
Confirm zero type errors from the new exports.

---

### Step 2 — test: Unit tests for fmtShortDate and selectOhlcBar

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/protoTime.test.ts` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: existing test file at `src/lib/protoTime.test.ts:1-34` — 4 `timestampToMillis` cases + 2 `timestampToDate` cases
- Confirmed via: `vitest.config.ts:20` — `include: ['src/**/*.test.ts']`; coverage scope `src/lib/**` at `:25`
- Confirmed via: design.md §2 — skip-today UTC edge case should be unit-tested with vitest

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4`

**Instructions**:

1. Add `fmtShortDate` and `selectOhlcBar` to the import from `./protoTime`.

2. Add a `describe('fmtShortDate')` block with cases:
   - UTC midnight timestamp `2026-09-10T00:00:00Z` → `"Sep 10"` (AC-1/AC-2 expected format)
   - January 1 → `"Jan 1"` (single-digit day, no leading zero)
   - Verifies `timeZone: 'UTC'` — a date that would render as the previous day in `America/New_York` without the UTC option

3. Add a `describe('selectOhlcBar')` block with cases:
   - Empty bars array → `undefined` (AC-4 — no bars available)
   - Single completed bar (date != today) → returns that bar's OHLC + date
   - Two bars, most recent is today → skips it, returns the previous bar (skip-today guard)
   - Two bars, neither is today → returns the most recent (last) bar
   - Bar with missing `time` → skipped gracefully
   - All bars are today → returns `undefined`

   Use the `now` parameter for deterministic today-detection. Construct bar objects with
   `{ time: { seconds: BigInt(epoch), nanos: 0 }, open, high, low, close }`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:coverage && pnpm run lint
```
Confirm vitest passes with ≥40% coverage on exercised `src/lib/**` files. Confirm lint passes.

---

### Step 3 — service: Refactor useSparklines to useOhlcBars

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useSparklines.ts` — delete
- `services/xstockstrat-ui/src/hooks/useOhlcBars.ts` — create

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via: `src/hooks/useSparklines.ts:10` — `SPARKLINE_BARS = 20` (change to 2)
- Confirmed via: `src/hooks/useSparklines.ts:25` — query key `['sparkline', symbol]` (change to `['ohlcBar', symbol]`)
- Confirmed via: `src/hooks/useSparklines.ts:30` — `page: { pageSize: SPARKLINE_BARS }` (will become `pageSize: 2`)
- Confirmed via: `src/hooks/useSparklines.ts:33-34` — maps `Bar.close` → `SparklinePoint`; replace with `selectOhlcBar(res.bars)` → `OhlcData | undefined`
- Confirmed via: `src/hooks/useSparklines.ts:5-8` — `SparklinePoint` / `SparklinePointSchema` imports to remove
- Confirmed via: design.md §1 — rename to `useOhlcBars`, `pageSize: 2`, return `Map<string, OhlcData | undefined>`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Create `src/hooks/useOhlcBars.ts` as a renamed refactor of `useSparklines.ts`:
   - Remove imports of `create` from `@bufbuild/protobuf`, `SparklinePoint`, `SparklinePointSchema` from analysis proto
   - Import `selectOhlcBar` and re-export `type OhlcData` from `@/lib/protoTime`
   - Rename constant: `OHLC_BAR_COUNT = 2` (down from 20 — YAGNI)
   - Rename stale time constant: `OHLC_STALE_MS = 120_000`
   - Rename export: `export function useOhlcBars(symbols: string[]): Map<string, OhlcData | undefined>`
   - Change query key: `['ohlcBar', symbol]`
   - Change `pageSize`: `OHLC_BAR_COUNT`
   - Change queryFn return type: `Promise<{ symbol: string; data: OhlcData | undefined }>`
   - Replace the `res.bars.map(...)` body with `const data = selectOhlcBar(res.bars);`
   - Change the result map to `Map<string, OhlcData | undefined>`, setting `map.set(q.data.symbol, q.data.data)` for each successful query
   - Preserve: `staleTime`, `retry: 0`, `refetchOnWindowFocus: false`, `useQueries` batch pattern, `insightsMarketDataClient.getBars` call

2. Delete `src/hooks/useSparklines.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```
Type check will show errors from the two consumer pages (Steps 5–6 fix those). Confirm only the
expected import errors from `page.tsx` files referencing the old hook, no errors from the new hook.

---

### Step 4 — service: Create OhlcBlock component

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/OhlcBlock.tsx` — create

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: design.md §4 — `OhlcBlock.tsx` props `data: OhlcData | undefined`, `testId?: string`
- Confirmed via: `src/lib/money.ts:4` — `fmtUsd` formats `$NNN.NN` (design.md — "Patterns to REUSE")
- Confirmed via: design.md §4 — styling `font-mono text-xs tabular-nums whitespace-nowrap overflow-hidden text-ellipsis`, `title` attribute, `aria-label`
- Confirmed via: `src/components/shared/Sparkline.tsx:14` — existing sparkline uses `aria-hidden` (decorative); OhlcBlock uses `aria-label` instead (informational text)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Create `src/components/shared/OhlcBlock.tsx`:
   ```tsx
   import type { OhlcData } from '@/hooks/useOhlcBars';
   import { fmtShortDate } from '@/lib/protoTime';
   import { fmtUsd } from '@/lib/money';

   export function OhlcBlock({ data, testId }: { data: OhlcData | undefined; testId?: string }) {
     if (!data) return null;
     const text = `${fmtShortDate(data.date)}  O ${fmtUsd(data.open)}  H ${fmtUsd(data.high)}  L ${fmtUsd(data.low)}  C ${fmtUsd(data.close)}`;
     return (
       <span
         className="font-mono text-xs tabular-nums whitespace-nowrap overflow-hidden text-ellipsis"
         title={text}
         aria-label={`OHLC for ${fmtShortDate(data.date)}: Open ${fmtUsd(data.open)}, High ${fmtUsd(data.high)}, Low ${fmtUsd(data.low)}, Close ${fmtUsd(data.close)}`}
         data-testid={testId}
       >
         {text}
       </span>
     );
   }
   ```

2. When `data` is `undefined`, the component renders nothing (progressive-enhancement absence
   pattern preserved from both existing call sites).

**Verification**:
```bash
cd services/xstockstrat-ui && npx tsc --noEmit --project tsconfig.json 2>&1 | grep -i "OhlcBlock" | head -5
```
Confirm no type errors from the new component. (Consumer page errors from the old sparkline
imports are expected until Steps 5–6.)

---

### Step 5 — service: Replace sparkline on Opportunities page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: `page.tsx:28` — `import { Sparkline } from '@/components/shared/Sparkline'` (remove)
- Confirmed via: `page.tsx:33` — `import { useSparklines } from '@/hooks/useSparklines'` (replace)
- Confirmed via: `page.tsx:177` — `const sparklines = useSparklines(sparklineSymbols)` (rename)
- Confirmed via: `page.tsx:339` — `sparklinePoints={sparklines.get(g.symbol)}` (rename prop)
- Confirmed via: `page.tsx:381` — `sparklinePoints?: import('...').SparklinePoint[]` prop type in `SymbolGroupCard` (change to `OhlcData | undefined`)
- Confirmed via: `page.tsx:416` — `sparklinePoints={sparklinePoints}` in `OpportunityRow` (rename prop)
- Confirmed via: `page.tsx:438` — `sparklinePoints?: import('...').SparklinePoint[]` prop type in `OpportunityRow` (change)
- Confirmed via: `page.tsx:518-520` — enrichment guard `sparklinePoints && sparklinePoints.length > 0` (change to `ohlcData !== undefined`)
- Confirmed via: `page.tsx:540-541` — `<Sparkline points={sparklinePoints} testId={...} />` (replace with `<OhlcBlock>`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Replace imports:
   - Remove: `import { Sparkline } from '@/components/shared/Sparkline'` (line 28)
   - Replace: `import { useSparklines } from '@/hooks/useSparklines'` → `import { useOhlcBars } from '@/hooks/useOhlcBars'` (line 33)
   - Add: `import { OhlcBlock } from '@/components/shared/OhlcBlock'`
   - Add: `import type { OhlcData } from '@/hooks/useOhlcBars'` (if the inline prop types need it)

2. Rename hook call at line 177: `const ohlcBars = useOhlcBars(sparklineSymbols)` (the
   `sparklineSymbols` memo variable name may also be renamed to `ohlcSymbols` for clarity).

3. Thread `ohlcData` through `SymbolGroupCard` props:
   - Line 339: `ohlcData={ohlcBars.get(g.symbol)}`
   - Line 381 (prop type): `ohlcData?: OhlcData | undefined` (remove `sparklinePoints` type)
   - Lines 373/431 (destructured prop name): rename `sparklinePoints` → `ohlcData`

4. Thread `ohlcData` through `OpportunityRow` props:
   - Line 416: `ohlcData={ohlcData}`
   - Line 438 (prop type): `ohlcData?: OhlcData | undefined`

5. Update enrichment guard-condition at lines 518-520:
   - Change `(sparklinePoints && sparklinePoints.length > 0)` to `ohlcData !== undefined`
   - This prevents a silent enrichment-row regression for symbols with OHLC but no live price.

6. Replace sparkline rendering at lines 540-541:
   - Change from: `{sparklinePoints && sparklinePoints.length > 0 && (<Sparkline points={sparklinePoints} testId={...} />)}`
   - Change to: `<OhlcBlock data={ohlcData} testId={`opp-ohlc-${o.symbol}`} />`
   - The `OhlcBlock` handles the `undefined` case internally (renders nothing).

**Verification**:
```bash
cd services/xstockstrat-ui && npx tsc --noEmit --project tsconfig.json 2>&1 | grep -v "useSparklines\|Sparkline" | head -10
```
Confirm no type errors from the opportunities page. The symbol detail page (Step 6) will still
have errors from the old imports.

---

### Step 6 — service: Replace sparkline on symbol detail page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: `page.tsx:19` — `import { useSparklines } from '@/hooks/useSparklines'` (replace)
- Confirmed via: `page.tsx:31` — `import { Sparkline } from '@/components/shared/Sparkline'` (remove)
- Confirmed via: `page.tsx:222-224` — sparkline hook usage: `sparklineSymbols` memo, `useSparklines(sparklineSymbols)`, `sparklines.get(symbol)`
- Confirmed via: `page.tsx:478-479` — `{headerSparkline && headerSparkline.length > 0 && (<Sparkline points={headerSparkline} testId="detail-sparkline" />)}`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Replace imports:
   - Remove: `import { Sparkline } from '@/components/shared/Sparkline'` (line 31)
   - Replace: `import { useSparklines } from '@/hooks/useSparklines'` → `import { useOhlcBars } from '@/hooks/useOhlcBars'` (line 19)
   - Add: `import { OhlcBlock } from '@/components/shared/OhlcBlock'`

2. Rename hook usage at lines 222-224:
   - Keep the symbols memo (may rename `sparklineSymbols` → `ohlcSymbols`)
   - Change `const sparklines = useSparklines(sparklineSymbols)` → `const ohlcBars = useOhlcBars(ohlcSymbols)`
   - Change `const headerSparkline = sparklines.get(symbol)` → `const headerOhlc = ohlcBars.get(symbol)`

3. Replace sparkline rendering at lines 478-479:
   - Change from: `{headerSparkline && headerSparkline.length > 0 && (<Sparkline points={headerSparkline} testId="detail-sparkline" />)}`
   - Change to: `<OhlcBlock data={headerOhlc} testId="detail-ohlc" />`

**Verification**:
```bash
cd services/xstockstrat-ui && npx tsc --noEmit --project tsconfig.json 2>&1 | head -10 && pnpm run lint
```
Confirm zero type errors and lint passes. At this point, neither consumer page imports the
shared `Sparkline` component — Step 7 can safely delete it.

---

### Step 7 — service: Delete shared Sparkline.tsx

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/Sparkline.tsx` — delete

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- Confirmed via: recon.md — shared `Sparkline.tsx` has exactly 2 import sites (opportunities page `:28`, symbol detail page `:31`), both removed by Steps 5–6
- Confirmed via: `grep -rn "from.*Sparkline" src/` — only the two import sites above; `FormulaRunResult.tsx:14` defines a LOCAL `Sparkline` function (recharts `LineChart`), it does NOT import the shared component
- Confirmed via: design.md §7 — safe to delete

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Delete `src/components/shared/Sparkline.tsx`.

2. Verify no remaining imports:
   ```bash
   grep -rn "from.*shared/Sparkline\|from.*Sparkline" services/xstockstrat-ui/src/
   ```
   Must return zero results. The `FormulaRunResult.tsx` local function `Sparkline` is defined
   inline (line 14) and does not reference the shared file.

**Verification**:
```bash
cd services/xstockstrat-ui && npx tsc --noEmit --project tsconfig.json 2>&1 | head -5 && echo "--- grep orphan imports ---" && grep -rn "from.*shared/Sparkline" src/ || echo "No orphan imports found"
```
Confirm zero type errors and zero orphan imports.

---

### Step 8 — test: Update E2E tests and mock-backend

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: `opportunities.spec.ts:187-201` — test title "20-point sparkline"; asserts `opp-sparkline-CAPR` visibility, 20 span count, 1 gap bar
- Confirmed via: `position-detail.spec.ts:782` — asserts `detail-sparkline` visible
- Confirmed via: `position-detail.spec.ts:806` — asserts `detail-sparkline` count=1 (ZZZZ off-queue path)
- Confirmed via: `mock-backend.ts:576-584` — CAPR getBars returns 20 bars with identical O/H/L/C (all = close value); needs distinct OHLC values for meaningful assertions
- Confirmed via: `mock-backend.ts:596-627` — non-CAPR fallback returns 2 AAPL bars with distinct OHLC (open: 188.0, high: 190.5, low: 187.2, close: 189.8 for bar 1; open: 189.8, high: 192.0, low: 188.5, close: 191.5 for bar 2)
- Confirmed via: design.md §9 — testIds `opp-sparkline-*` → `opp-ohlc-*`, `detail-sparkline` → `detail-ohlc`; keep `CAPR_SPARKLINE` fixture
- Confirmed via: `e2e/fixtures/INVENTORY.md:28` — Opportunity queue row describes sparkline data

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5`

**Instructions**:

1. **`e2e/mock-backend.ts`** — update CAPR getBars handler (lines 576-584):
   - Reduce bar count from 20 to 2 (matching the new `pageSize: 2`)
   - Give the 2 CAPR bars **distinct** O/H/L/C values for meaningful OHLC assertions. Example:
     Bar 0 (older): `{ open: 11.80, high: 12.10, low: 11.65, close: 11.92 }` with time 2024-01-18
     Bar 1 (newer, the "yesterday" bar): `{ open: 11.92, high: 12.25, low: 11.78, close: 12.15 }` with time 2024-01-19
   - Remove the gap-bar logic (index 5 gap is no longer relevant — OHLC text has no gap concept)
   - The non-CAPR fallback (lines 596-627) already returns 2 AAPL bars with distinct OHLC; no change needed there

2. **`e2e/insights/opportunities.spec.ts`** — rewrite the sparkline test (lines 187-201):
   - Rename test: replace "20-point sparkline" with "previous day OHLC"
   - Change testId: `opp-sparkline-CAPR` → `opp-ohlc-CAPR`
   - Assert OHLC text content: the `opp-ohlc-CAPR` element should contain the formatted date and
     `O`, `H`, `L`, `C` labels with the CAPR bar values from the updated mock
   - Remove the 20-span count assertion and the gap-bar assertion (lines 197-198)
   - Remove the "AC-3" / "AC-4" sparkline-specific comments; replace with OHLC-specific comments
   - Add an assertion that no sparkline chart is rendered (no element with `aria-hidden` bar structure)

3. **`e2e/trader/position-detail.spec.ts`**:
   - Line 782: change `detail-sparkline` → `detail-ohlc` and adjust assertion to check visibility
     of OHLC text (the CAPR symbol uses the updated CAPR getBars mock)
   - Line 806: change `detail-sparkline` → `detail-ohlc` and adjust the count assertion. The ZZZZ
     symbol hits the non-CAPR getBars fallback which returns 2 AAPL bars (most recent: Jan 2,
     open 189.8, high 192.0, low 188.5, close 191.5). Assert OHLC text content matches.

4. **`e2e/fixtures/opportunities.ts`** — keep `CAPR_SPARKLINE` as-is. It populates the
   `Opportunity.sparkline` proto field 17 for `ListOpportunities` mock data (a different data
   path from the `getBars` hook). Proto cleanup is a separate PR.

5. **`e2e/fixtures/INVENTORY.md`** — update row 28 (Opportunity queue):
   - Update the sparkline description to note that the CAPR `sparkline` fixture is retained for
     proto round-trip fidelity but is no longer rendered in the UI (OHLC block reads from `getBars`)
   - Note the updated CAPR getBars mock (2 bars with distinct OHLC, feature 188)

6. **AC-5 coverage**: confirm that no test file imports from `@/components/shared/Sparkline` or
   `../../../components/shared/Sparkline` — the shared component is deleted. The
   `FormulaRunResult.tsx` local `Sparkline` function (recharts `LineChart`) is unchanged and
   has its own existing test coverage.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && grep -rn "opp-sparkline-\|detail-sparkline\|from.*shared/Sparkline" e2e/ src/ || echo "No stale sparkline references"
```
Confirm lint passes and no stale sparkline testIds or imports remain. Full E2E run:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- --grep "OHLC\|sparkline\|live price\|off-queue"
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
