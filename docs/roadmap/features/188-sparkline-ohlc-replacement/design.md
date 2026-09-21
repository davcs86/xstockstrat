# Design: sparkline-ohlc-replacement

**Created**: 2026-09-11
**Rounds**: 2 (quick; termination: approved)
**Approved by**: user @ 2026-09-11
**Grounded in**: recon.md

---

## Chosen Approach

**Consumer surface**: UI — `/insights` (Opportunities List) and `/trader` (symbol detail page).

### 1. Refactor `useSparklines` → `useOhlcBars` (in-place)

Rename `src/hooks/useSparklines.ts` → `src/hooks/useOhlcBars.ts` and the hook export to
`useOhlcBars`. Change `pageSize` from 20 to 2 (`recon.md` — `src/hooks/useSparklines.ts:30`).
Return `Map<string, OhlcData | undefined>` instead of `Map<string, SparklinePoint[]>`.

Export the `OhlcData` type from the hook file (not the component — avoids inverted dependency):
```ts
export type OhlcData = { date: Date; open: number; high: number; low: number; close: number };
```

Drop the `SparklinePoint` / `SparklinePointSchema` imports (`recon.md` — `src/hooks/useSparklines.ts:6-7`). The `useQueries` batch pattern is reused in-place (`recon.md` — `src/hooks/useSparklines.ts:23-43`).

### 2. Skip-today-bar guard

With `pageSize: 2`, the hook receives up to 2 bars (ascending chronological order — verified at
`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:183-186`). The most recent
bar is `bars[bars.length - 1]`. If its UTC date (`getUTCFullYear/getUTCMonth/getUTCDate`) matches
today's UTC date, use the second-to-last bar instead. This prevents displaying a partially-formed
intraday bar during market hours.

### 3. `fmtShortDate` utility

Add to `src/lib/protoTime.ts` (coheres with existing `timestampToDate`/`timestampToMillis`):
```ts
export function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
```
The `timeZone: 'UTC'` option is mandatory — daily `Bar.time` is stored as UTC midnight
(`timestamppb.New(t)` at `marketdata_repo.go:142`); without it, negative-UTC-offset browsers
(e.g. America/New_York) would render the date one day off.

### 4. `OhlcBlock` component

New `src/components/shared/OhlcBlock.tsx`. Props: `data: OhlcData | undefined`, `testId?: string`.

Renders:
```
Sep 10  O $228.50  H $231.20  L $227.80  C $230.10
```

Uses `fmtUsd` from `src/lib/money.ts:4` (recon.md — Patterns to REUSE). Uses `fmtShortDate` from
`protoTime.ts`. Styling: `font-mono text-xs tabular-nums whitespace-nowrap overflow-hidden
text-ellipsis` with a `title` attribute for full text on overflow (mobile-width safety per
`@AC-9 @feature-155`). `aria-label` with expanded text for screen readers (informational text,
not decorative like the sparkline's `aria-hidden` at `Sparkline.tsx:14`).

When `data` is `undefined`, renders nothing (progressive-enhancement absence pattern preserved
from both call sites — `recon.md`).

### 5. Replace sparkline on Opportunities page

- Swap `<Sparkline>` for `<OhlcBlock>` at `src/app/insights/opportunities/page.tsx:540-541`
- Thread `ohlcData` through `SymbolGroupCard` props (replacing `sparklinePoints`) at `:339,381,416,438`
- **Update enrichment guard-condition** at `~:518-520`: change from
  `sparklinePoints && sparklinePoints.length > 0` to `ohlcData !== undefined` (prevents silent
  enrichment-row regression for symbols with OHLC but no live price)

### 6. Replace sparkline on symbol detail header

- Swap `<Sparkline>` for `<OhlcBlock>` at `src/app/trader/positions/[symbol]/page.tsx:478-479`

### 7. Delete shared `Sparkline.tsx`

`src/components/shared/Sparkline.tsx` has exactly 2 import sites (opportunities page `:28`,
symbol detail page `:31` — `recon.md:19`), both removed by steps 5–6. `FormulaRunResult.tsx:14`
defines its own local `Sparkline` function using `recharts` `LineChart` — it does NOT import the
shared component (`recon.md:38-43`). Safe to delete.

### 8. Rewrite AC-5 acceptance scenario

The current `acceptance.feature` AC-5 is factually wrong — it claims FormulaRunResult imports
the shared Sparkline. Rewrite to: shared Sparkline.tsx deleted; FormulaRunResult unaffected
(uses local recharts function). Must still cover FR-5 for C-15 traceability.

### 9. E2E test + fixture updates

- TestIds: `opp-sparkline-*` → `opp-ohlc-*`, `detail-sparkline` → `detail-ohlc`
- OHLC text assertions using getBars mock data (already has OHLC fields at `mock-backend.ts:578-584`)
- Keep `CAPR_SPARKLINE` fixture as-is — it populates `Opportunity.sparkline` proto field 17 for the
  ListOpportunities mock, a different data path from the getBars hook. Remove or keep for proto
  round-trip fidelity (implementation decision)
- React Query key: `['sparkline', symbol]` → `['ohlcBar', symbol]` (no external references)

## Rejected Alternatives

- **Keep `pageSize: 20` unchanged** — wastes 18 bars per symbol per fetch for data the OHLC block
  doesn't use. YAGNI: the hook's only consumer now needs 1–2 bars, not 20. Rejected for
  unnecessary bandwidth.
- **`Intl.DateTimeFormat` cached instance** — marginally faster than per-call `toLocaleDateString`,
  but negligible for ~10–50 symbols on screen. Rejected for added complexity without measurable gain.
- **Place `fmtShortDate` in `money.ts`** — rejected for poor cohesion; date formatting belongs with
  `timestampToDate` in `protoTime.ts`.
- **Define `OhlcData` type in the component file** — rejected for inverted dependency (component file
  would become the type authority imported by the hook).

## Open Risks

- [ ] **Bar ordering assumption** — the hook assumes ascending chronological (`bars[bars.length - 1]`
  = most recent). Verified via `marketdata_repo.go:183-186` (explicit reverse), but should be
  validated at implementation time against the actual getBars response.
- [ ] **Skip-today UTC date comparison edge** — users in far-ahead timezones (UTC+12) on a Saturday
  could theoretically see the guard behave unexpectedly. Mitigated by UTC comparison on both sides
  (guard + fmtShortDate). Should be unit-tested with vitest.
- [ ] **`SparklinePoint` proto orphaning** — `Opportunity.sparkline` field 17 still exists in
  `analysis.proto:572`. No UI consumer after this change. Proto-side cleanup is a separate PR
  (non-breaking removal requires a feature deprecation cycle).

## Constitution Rules Touched

- `C-14` — honored by: consumer surfaces (`/insights`, `/trader`) explicitly named and scoped.
- `C-15` — honored by: AC-5 rewritten to match factual finding; all FRs still covered by ≥1 AC.
- `C-16` — honored by: CHANGE of @AC-3/@AC-4 signed off by user (this approval); 6 PRESERVE rules
  not regressed (guard-condition update, layout preservation, live price orthogonality).
- `C-17` — honored by: `OhlcBlock` uses `font-mono text-xs tabular-nums`, `aria-label` for a11y,
  `whitespace-nowrap overflow-hidden text-ellipsis` for mobile safety.
- `P-03` — honored by: `fmtShortDate` uses `timeZone: 'UTC'` to match UTC bar timestamps;
  skip-today guard uses UTC date comparison. No silent deviation.
- `F-04` — honored by: all paths cited in recon.md; no invented paths.

## Business Rules Touched (C-16)

- CHANGE `@AC-3` "A queue card renders a price sparkline from recent bars"
  (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — sparkline
  replaced by OHLC text block; signed off by user @ 2026-09-11 (context.md).
- CHANGE `@AC-4` "A sparkline warm-up gap renders as null, never NaN"
  (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — warm-up gap
  concept no longer applicable; new guarantee is "OHLC absent when bars unavailable" (FR-4);
  signed off by user @ 2026-09-11 (context.md).
- PRESERVE `@AC-1` "An Opportunities queue card shows live price and change%" — not regressed:
  live price display is orthogonal to the sparkline→OHLC swap.
- PRESERVE `@AC-2` "The Signal-detail header shows live price and change%" — not regressed: same.
- PRESERVE `@AC-11` "An unavailable live quote omits the price field rather than fabricating it"
  — not regressed: OHLC follows the same progressive-enhancement absence pattern.
- PRESERVE `@AC-12 @feature-095` "The live price shown on the Decide surface equals the price on
  the Signal-detail surface" — not regressed: cross-surface price parity is orthogonal.
- PRESERVE `@AC-3 @feature-155` "The in-queue marker is icon-coded consistently" — not regressed:
  in-queue badge survives layout change (OhlcBlock replaces sparkline in same card slot).
- PRESERVE `@AC-9 @feature-155` "Mobile Opportunities groups signals by symbol" — not regressed:
  OhlcBlock uses truncation styling for mobile width; SymbolGroupCard layout preserved.
- PRESERVE `@AC-3 @feature-185` "The Decide queue renders the unavailable state explicitly" — not
  regressed: C-17 unavailable cue is independent of the OHLC block presence.
