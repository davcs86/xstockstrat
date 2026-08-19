# Recon: unify-symbol-chart-libraries

**Created**: 2026-08-18
**From**: product-spec.md
**Affected services**: xstockstrat-ui (only; consumer surface = /trader segment, symbol page)

---

## Objective

On `/trader/positions/[symbol]`, make the OHLCV price chart (lightweight-charts, via
`useCandlestickChart`) and the indicator overlay panels (recharts via shadcn `ui/chart`) read as one
instrument: a single aligned **time** x-axis and a consistent visual language (gridlines, tick
typography, crosshair/tooltip, `--chart-*` color tokens, height rhythm). The two surfaces already
share the page's single bars fetch; the mismatch is presentational, not a data problem.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - Symbol page: `src/app/trader/positions/[symbol]/page.tsx`
    - Single bars fetch → both charts; hook call at 260px — `page.tsx:116`
    - Captured `closes`+`times` for the panels (parity, no 2nd fetch), populated in the `getBars`
      `.then`: `withTime = res.bars.filter((b) => b.time)` — `page.tsx:119-124, 203-208`
    - `SymbolPriceChart` + `IndicatorSection` rendered together in `#overview`
      (`closes={barSeries.closes} times={barSeries.times}`) — `page.tsx:382-401`
    - avg-cost / stop dashed reference overlays via `createPriceLine` (hard-coded `#94a3b8` /
      `#e0787a`, `LineStyle.Dashed`), replaced-not-stacked via `priceLinesRef` —
      `page.tsx:72, 126-127, 213, 215-238`
    - Held/unheld handling: overlays computed from safe page-level locals regardless of position —
      `page.tsx:132-135`; effect deps include `avg, stop` — `page.tsx:246`
    - `SymbolPriceChart` component (chart div `height:260`) — `page.tsx:467-518` (div `:500`)
    - `IndicatorSection` (resolves strategy, gates RPC on `hasComponents`, renders
      `<IndicatorPanels components={series!.components} />`) — `page.tsx:1105-1163` (render `:1145`)
  - Price chart hook: `src/hooks/useCandlestickChart.ts`
    - Dynamic `import('lightweight-charts')` → `createChart`; **v4 API** `addCandlestickSeries`
      (comment flags v5 `addSeries(CandlestickSeries)` rename) — `:21-34`
    - Colors **hard-coded hex** (NOT tokens): textColor `#94a3b8`, grid `#1e293b`, borders `#334155`,
      up `#22c55e` / down `#ef4444`; `timeVisible: true`, crosshair `mode: 1`, transparent bg — `:26-40`
    - ResizeObserver + teardown (`chart.remove()`) — `:43-53`; returns `{ containerRef, seriesRef }` — `:58`
  - Indicator panels: `src/components/trader/IndicatorPanels.tsx`
    - recharts via `@/components/ui/chart` (`ChartContainer`/`ChartTooltip`/`ChartTooltipContent`) — `:1-10`
    - One panel per component; each `NamedSeries` its own `<Line>` (value/signal/histogram) — `:34-38, 79-90`
    - Per-component fault isolation: `comp.error` → error strip, no chart — `:42-51`
    - Warm-up/gap: `s.values[i]?.value ?? null` + `connectNulls={false}` (never fabricated 0) — `:63-67, 88`
    - **X-axis = hidden integer index** (`dataKey="i"` rows + `<XAxis dataKey="i" hide />`) — `:59, 76`
    - Colors from tokens: `SERIES_COLORS = var(--chart-1..5)` → `ChartConfig` →
      `stroke={`var(--color-${s.name})`}` — `:19-25, 53-56, 84`
    - Consumes `components: ComponentSeries[]` already index-aligned to the page's bars
  - shadcn chart wrapper: `src/components/ui/chart.tsx` — `ChartContainer`/`ChartStyle`
    (emits `--color-<key>` from config), `ChartTooltip(Content)`, `ChartLegend` — `:42-107, 109-248`
  - `--chart-*` tokens: `src/app/globals.css:27-31` (`@theme inline` → `--color-chart-1..5`),
    oklch values `:root` — `:107-111`
  - Indicator series hook: `src/hooks/useIndicatorSeries.ts:10-28` (cross-segment `analysisClient`,
    enabled only when strategy + bars present, passes exact `closes`/`times`)
  - Bar mapping / time-axis source: `src/lib/chart.ts` — `Timeframe`, `TIMEFRAME_ENUM`, `mapBars`
  - Other direct hook consumer: `src/components/trader/ChartPanel.tsx` (dashboard, used by
    `src/app/trader/page.tsx:7,39`)
  - Versions: recharts `^3.10.1`, lightweight-charts `^4.2.0` — `package.json:54, 46`

## Patterns to REUSE

- **Aligned time domain** → the panels already receive the parity `times` via `useIndicatorSeries`
  (`useIndicatorSeries.ts:10-28`) and the page's `barSeries.times` (`page.tsx:119-124, 382-401`);
  reuse that array as the recharts XAxis domain instead of the hidden integer index — no new fetch.
- **Color tokens** → reuse the existing `--chart-1..5` token map (`globals.css:27-31, 107-111`) and
  the shadcn `ChartStyle` `--color-<key>` mechanism (`chart.tsx`); move the candlestick hook's
  hard-coded hex onto these tokens rather than inventing a new palette.
- **shadcn chart wrapper** (`ui/chart.tsx`) → reuse `ChartContainer`/`ChartTooltip` conventions for
  any recharts-side tooltip/axis unification; don't hand-roll a second chart shell.
- **Bar→time mapping** → reuse `src/lib/chart.ts` `mapBars` as the single time-domain source of truth.
- **e2e fixtures** → reuse `INDICATOR_SERIES_AAPL` (`e2e/fixtures/indicatorSeries.ts:22-42`,
  `INVENTORY.md:32`) and the inline `getBars` AAPL bars (with `time`) in `e2e/mock-backend.ts:429-464`;
  do not add a parallel fixture (C-13).
- **Auth helpers** → `e2e/helpers/auth.ts` `addAuthCookie`/`addAdminCookie` for any new/edited spec.

## Dependencies

- Proto/RPC: **none** — `GetIndicatorSeries` + `ComponentSeries{ref_name=1,kind=2,series=3,error=4}` /
  `NamedSeries` / `IndicatorValue{optional double value=1}` and the aligned `times` field already
  exist — `packages/proto/analysis/v1/analysis.proto:584-626` (RPC `:46`).
- Migration: none (no DB surface).
- Config keys: none.
- Inter-service edges: unchanged (ui → analysis `GetIndicatorSeries`; ui → marketdata `GetBars`).
- New env vars / ports: none. (`playwright.config.ts:159-177` already sets `MARKETDATA_ENDPOINT` /
  `ANALYSIS_ENDPOINT`.)

## Risks / Not-found

- **CLAUDE.md doc-drift (found):** `services/xstockstrat-ui/CLAUDE.md:70-72` names
  `insights/market/[symbol]/page.tsx` as a third `useCandlestickChart`/lightweight-charts consumer,
  but that page renders **no chart today** (grep for `Chart|lightweight|createChart|recharts` → 0
  matches). Real hook consumers are only `ChartPanel.tsx` + the trader symbol page. → context-scrubber
  fix if the hook is touched; also shrinks the "3 shared consumers" rationale for the sanctioned
  exception.
- **No shared time-axis abstraction exists** between the two libraries — candlestick uses a real
  lightweight-charts `timeScale` (visible date axis); `IndicatorPanels` uses a hidden integer index.
  The aligned `times` are carried but never rendered on the panel axis. This gap IS the feature.
- **Sanctioned exception (`CLAUDE.md:69-76`)** keeps OHLCV on lightweight-charts ("recharts has no
  first-party OHLCV candlestick geometry") and warns the `.tv-lightweight-charts` DOM class is the
  e2e readiness signal (`chart-panel.spec.ts:144-151, 189-195`). FR-6's fork must uphold or explicitly
  supersede this at the human gate — and any price-chart change must preserve or replace that signal.
- **fails.md — self-decided chart-lib forks (123/121/122, L64):** the chart-library decision was
  previously self-run by a subagent debate and overridden at the live human gate. → run a real
  proposer/adversary round and put FR-6 to the user; do not self-decide.
- **fails.md — chart-panel test-support sibling wiring (014, L396-399; L232-234):** if new mock/env
  wiring is needed, mirror across `e2e/mock-backend.ts` AND `playwright.config.ts` `webServer.env`.
- **fails.md — new-page/chart-heavy E2E cold-compile (L585-587, L958-998):** verify statically
  (tsc/lint/prettier + `playwright test --list` + one diagnosed run) locally; defer full green to CI.
- **Prior art (already on main-dev):** feature 123 (`code-completed`) already bumped recharts to
  `^3.10.1` and recorded FR-5 = **keep lightweight-charts** (user-confirmed); build on it.
- **Rebase (soft):** 125/145/139 edit `page.tsx` / `IndicatorPanels.tsx`; re-verify citations at
  /sdd-spec against post-125/145/139 state (no hard merge-order row).

## Recommended Scope

Advisory (grilling + /sdd-spec refine): (1) give `IndicatorPanels` a real time-based XAxis driven by
the parity `times` it already carries (replace the hidden integer index), aligning left-edge/tick
positions with the candlestick time scale; (2) move the candlestick hook's hard-coded hex onto the
existing `--chart-*` / theme tokens so both surfaces share one palette; (3) harmonize gridline style,
tick typography, and crosshair/tooltip across the two; (4) preserve the `.tv-lightweight-charts`
readiness signal and all indicator correctness (per-component fault isolation, gaps-not-0s); (5)
update the CLAUDE.md sanctioned-exception note (doc-drift + whichever fork is chosen). The
charting-library fork (FR-6: move panels onto lightweight-charts vs. keep both under a shared domain)
is decided at the human gate in Phase 1.
