# Recon: fix-indicator-pane-warmup

**Created**: 2026-11-15
**From**: product-spec.md
**Tree**: feature/fix-indicator-pane-warmup@e35449908 (detached; contains origin/main-dev@67dcfc11a). Scout digests arrived `Checkout: UNSTAMPED`; every citation below was re-grepped on this tree.
**Affected services**: xstockstrat-ui, xstockstrat-analysis

---

## Objective

On the trader symbol page, an indicator whose lookback P is close to or longer than the charted
window W renders as a single dot (SMA200 on LYFT). The fix must give every charted bar a value
whenever P bars of history exist up to that bar (FR-1), and show "Not enough history" with no series
when H < P (FR-2, per indicator).

## Root Cause (operator decision 2026-11-15 — answered)

**The missing warm-up prefix is in the UI request, not in the analysis series builder.**

- The page fetches exactly 200 bars and keeps only those:
  `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:252-257`
  (`page: { pageSize: 200 }`), then `setBarSeries({ closes, times })` at `:262-265` and
  `series.setData(mapBars(res.bars))` at `:269`. So W equals the fetched bar count.
- The same closes and times go to the RPC: `page.tsx:529-537` → `IndicatorSection` (`:1303`) →
  `useIndicatorSeries` (`:1324`) → `services/xstockstrat-ui/src/hooks/useIndicatorSeries.ts:18-23`.
- The handler computes on the supplied closes only and never fetches bars for the evaluated symbol:
  `services/xstockstrat-analysis/app/handlers/servicer.py:4545` (`closes = list(request.closes)`),
  `:4606` (`_compute_component(comp, closes)`), `:4634-4636` (`times=request.times`).
- This is the documented contract, not an analysis defect:
  `packages/proto/analysis/v1/analysis.proto:806-808` ("the page passes the exact bars it drew … no
  server re-fetch happens").
- SMA(200) over 200 closes is first valid at index 199, so exactly one point, on the last bar. This
  matches the report (one dot at 15.07 across a ~200-bar window).

Consequence: FR-1 needs no analysis change if the UI sends a longer series. FR-2 needs each
component's P, which nothing returns today; where P comes from is the open design fork (see
Recommended Scope).

## Codebase Map

- **`xstockstrat-ui`** (Next.js)
  - Entry point: `src/app/trader/positions/[symbol]/page.tsx:248` (`loadBars`)
  - Handler/servicer: BFF forward `src/lib/insightsBff.ts:74` (`getIndicatorSeries`); browser client
    `src/lib/browserClients/analysisClient` via `src/hooks/useIndicatorSeries.ts:8-26`
  - Last migration: n/a
  - Config-read pattern: n/a (no config on this path in the UI)
  - Other key symbols:
    - `barSeries` state and its "no second bars fetch" comment — `page.tsx:132-133`
    - `IndicatorSection` — `page.tsx:1303`; strategy already loaded via `useGetStrategy` at `:1320`
      (component params are available client-side)
    - Query key `['indicator-series', strategyId, symbol, closes.length]` —
      `useIndicatorSeries.ts:16`; `enabled` at `:14`
    - `toLineData` (unset → whitespace point; iterates `times`) — `src/lib/indicatorChart.ts:27-37`;
      `normalizeAscendingUnique` — `:44`
    - `isChartable` (`!c.error && c.series.length > 0`) —
      `src/components/trader/IndicatorPanels.tsx:19-21`
    - Pane draw: one native pane per chartable component on the **candlestick's own chart**
      (`chartRef`), `line.setData(toLineData(s.values, paneTimes))` — `IndicatorPanels.tsx:93-104`
    - Error pane `indicator-panel-error` — `IndicatorPanels.tsx:172-176`; normal pane
      `indicator-panel` with `data-series-count` / `data-series` — `:179-185`
    - Loading / empty testids `indicator-panels-loading`, `indicator-panels-empty` —
      `page.tsx:1337`, `:1340`
- **`xstockstrat-analysis`** (Python)
  - Entry point / handler: `app/handlers/servicer.py:4516` (`GetIndicatorSeries`)
  - Last migration: `029_seed_fundamentals_blend_strategy.up.sql`
    (`services/xstockstrat-analysis/migrations/`) — not needed by this fix
  - Config-read pattern: `servicer.py:570`
    (`int_positive(self._cfg, "series.max_concurrent_components", 4)`)
  - Other key symbols:
    - `eval_dates` built from `request.times` only for `source_symbol`, fundamental and
      fundamentals-only-formula components — `servicer.py:4553-4565`
    - Unset warm-up point → `IndicatorValue()` — `servicer.py:4610-4617`
    - Per-component fault isolation → `error=_component_error_text(e)` — `servicer.py:4628-4633`
    - `_compute_component` — `app/services/evaluator.py:502`; tail-aligns with
      `align_indicator_points(resp.result, n)` at `:524` (defined `:806`)
    - `_assemble_component_series` (single seam behind every consumer) — `evaluator.py:710`
    - `declared_formula_warmups` — `evaluator.py:647`
    - `_benchmark_series_bars` (the RPC's only bar fetch, benchmark components) —
      `servicer.py:2029`, called at `:4577`
    - `_fetch_bars_paged` — `servicer.py:1481`; `_MAX_BAR_PAGES = 32` — `:302`
- **`xstockstrat-marketdata`** (Go) — not changed; its `GetBars` semantics bound the fix
  - No `range.start` → newest page, ascending: `internal/service/marketdata_service.go:301-303`,
    `:323-326` (`QueryRecentBars`)
  - Implicit window = `pageSize × interval × 3`: `marketdata_service.go:467-477`
    (`defaultBarLookback`)
  - `pageSize` outside 1..5000 falls back to 500: `internal/repository/marketdata_repo.go:181-183`
    (`QueryRecentBars`), `:101-103` (`QueryBars`)

## Patterns to REUSE

- Gap rendering for partially warm series (FR-1, P ≤ H < P + W − 1) → reuse `toLineData` unchanged
  at `services/xstockstrat-ui/src/lib/indicatorChart.ts:27-37`; it already maps unset to a gap and
  never fabricates 0.
- Unset-value wire contract → reuse `IndicatorValue` (`optional double value = 1`) at
  `packages/proto/analysis/v1/analysis.proto:843-845`; no new gap encoding.
- Per-pane non-chart state (FR-2) → model on the existing error pane at
  `services/xstockstrat-ui/src/components/trader/IndicatorPanels.tsx:172-176` (label + muted text),
  and extend `isChartable` (`:19-21`) so an insufficient-history component gets no chart pane.
- Lookback P on the analysis side (if design puts P there) → reuse
  `builtin_lookback_bars(indicator, params)` at
  `services/xstockstrat-analysis/app/services/warmup.py:70` and the declared formula
  `warmup_period` via `StrategyEvaluator.declared_formula_warmups` (`evaluator.py:647`). Do not add
  a second lookback table. Caveat on what these return under Risks.
- Per-component failure reporting → reuse `ComponentSeries.error`
  (`analysis.proto:823-826`) only for compute failures; "not enough history" is not an error.
- Newest-page bar read → reuse the existing `getBars` call with no `range.start`
  (`page.tsx:252-257`); only the page size changes.
- UI unit harness → `services/xstockstrat-ui/src/lib/indicatorChart.test.ts` (vitest,
  `pnpm run test:unit`).
- UI e2e harness → `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts:482-530`, mock
  `e2e/mock-backend.ts:1417` (`getIndicatorSeries`), fixture `e2e/fixtures/indicatorSeries.ts`
  (`INDICATOR_SERIES_AAPL`, catalog row `e2e/fixtures/INVENTORY.md:57`). New fixtures get an
  INVENTORY row in the same step (C-12/C-13).
- Analysis test harness → `services/xstockstrat-analysis/tests/test_analysis_servicer.py:7057`
  (`TestGetIndicatorSeries`), `tests/test_indicator_series_source_symbol.py`, `tests/test_warmup.py`
  (`uv run pytest`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4` "A sparkline warm-up gap renders as null, never NaN"
  (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature:31`) — a different
  code path (Opportunities sparkline), same gap contract. The fix must not introduce `NaN` or a
  fabricated `0` on indicator panes.
- **PRESERVE** `platform.feature` rule that `GetBars` does not add a symbol to the marketdata warm
  set — still holds if the UI asks `GetBars` for more bars.
- No existing acceptance rule covers the symbol-page indicator panes (`IndicatorPanels`,
  `indicatorChart.ts`, `useIndicatorSeries`) or `GetIndicatorSeries` in either service's suite.
  AC-1..AC-4 are additions. **No CHANGE flags; no user sign-off needed.**
- Out of scope, checked: `backfilled-data-queryable.feature` `@AC-1` (Data Explorer bars; relevant
  only if a shared bars hook changes — the symbol page calls `marketDataClient.getBars` inline),
  symbol-page OrderForm and fundamentals suites.
- Scan method: keyword grep over all `services/xstockstrat-ui/acceptance/*.feature`, all
  `services/xstockstrat-analysis/acceptance/*.feature` and `docs/sdd/business-rules/platform.feature`;
  the suites were not each read in full.

## Dependencies

- Proto/RPC: `GetIndicatorSeries` (`packages/proto/analysis/v1/analysis.proto:803-845`). Existing
  field numbers: request 1-4 (next free 5), response 1-2 (next free 3), `ComponentSeries` 1-4 (next
  free 5), `NamedSeries` 1-2, `IndicatorValue` 1. **None required for a UI-only fix**; any addition
  must be additive (`docs/runbooks/proto-versioning.md`, C-09).
- Migration: none.
- Config keys: none new. Existing `analysis.series.max_concurrent_components` (default 4) bounds
  per-component compute on this RPC.
- Inter-service edges: unchanged — `xstockstrat-ui` → `xstockstrat-marketdata` (`GetBars`),
  `xstockstrat-ui` → `xstockstrat-analysis` (`GetIndicatorSeries`).
- New env vars / ports: none.
- Other callers of `GetIndicatorSeries`: none. Only `useIndicatorSeries.ts` and `insightsBff.ts:74`
  in the UI; no reference under `services/xstockstrat-agent/app`, trading or portfolio (C-10/C-14
  hold with the UI alone).

## Risks / Not-found

- **Which P (product-spec review warning, still open).** `builtin_lookback_bars` returns bars to
  the first *usable* value, not the first value: SMA/BB `period − 1 + 1`, RSI/ATR `period + 1`,
  STOCH `period + 2`, EMA `3 × period + 1`, MACD `3 × (max(fast, slow) + signal) + 1`, VWAP 0
  (`warmup.py:80-112`). For SMA(200) this is 200 and equals the spec's P by coincidence (it includes
  the crossover bar). For EMA/MACD/VWAP the first value is on bar 1, so the spec's FR-2 test
  (H < P) can never fire unless design adopts the converged lookback. Design must pick one P per
  indicator family and state it; all four scenarios use SMA.
- **RSI/ATR/STOCH first-value index differs from SMA** (`warmup.py:86-94`); no scenario covers them.
  Add scenarios at design time if the chosen P makes them behave differently.
- **Custom formulas.** P is the declared `warmup_period`, known only to analysis
  (`evaluator.py:647`); the UI cannot derive it from strategy params. A UI-only P table would not
  cover them.
- **`len(closes) == len(times)` is assumed by the handler** and the response echoes `request.times`
  (`servicer.py:4634-4636`). If the UI sends W + prefix bars, either the UI slices every series to
  the last W, or an additive field tells the server to trim. `toLineData` iterates `times` from
  index 0, so a head-aligned slice is wrong; the slice must be tail-aligned.
- **Panes share the candlestick chart and its time scale** (`IndicatorPanels.tsx:93-104`,
  `chartRef`). The pane axis must stay the charted W bars; drawing the prefix would widen the price
  chart.
- **Query key uses `closes.length`** (`useIndicatorSeries.ts:16`). A request that changes prefix
  length without changing symbol or strategy must still invalidate correctly.
- **H is only observable as "bars returned".** With a larger `pageSize`, the implicit `GetBars`
  window grows to `pageSize × 3` intervals (`marketdata_service.go:467-477`), so a short page means
  short stored history for that window. Not verified: whether the staleness / DB-miss live refetch
  (`marketdata_service.go:334-345`) can return fewer bars than stored.
- **`GetBars` page cap.** `pageSize` above 5000 silently becomes 500 (`marketdata_repo.go:181-183`).
  W + P_max must stay under it or be clamped explicitly.
- **FR-2 gap today.** A component whose series are all unset is still chartable and gets an empty
  pane; no "Not enough history" string exists in `services/xstockstrat-ui/src`.
- **e2e mock does not compute.** `mock-backend.ts:1417-1422` returns a fixed fixture for AAPL and no
  components otherwise, and `mockDailyBars` ignores `pageSize`. AC-1..AC-4 at e2e level need new
  fixtures (400 / 200 / 150 bars, SMA200 + SMA20); the slice and state logic is better proven in
  vitest, with e2e covering the pane state and the outbound request.
- **Server re-fetch is a recorded rejected direction.** The proto comment (`analysis.proto:806-808`)
  and feature 125's context record that the client supplies closes because the candlestick fetches
  by page count, not a `TimeRange`. Not re-read here: `docs/roadmap/features/125-unified-symbol-page/context.md`.
- Applicable `fails.md` traps:
  - `GetBars` **with** a `range.start` returns the oldest page (`ORDER BY time ASC LIMIT`), so a
    prefix fetched by widening a start date drops the newest bars; keep the no-start newest-page
    read (fails.md "oldest ~500 bars" entry).
  - Asserting an outbound `GetBars` in a chart e2e races the async lightweight-charts init; wait for
    `.tv-lightweight-charts` first.
  - Colors passed to lightweight-charts must be canvas-parseable (relevant only if the FR-2 state
    touches series options; peer `chart-series-palette` owns colors).
- Applicable `insights.md` patterns:
  - Warm-up must be **declared, never observed**: EMA/MACD/VWAP emit a finite value at index 0, so
    inferring "insufficient history" from an all-unset series misses them
    (`services/xstockstrat-analysis/docs/warmup.md`).
  - Tail-alignment helpers assume a contiguous warm-up head.
  - Native multi-pane on one chart/one time scale is the established pattern; do not add a second
    chart engine or axis.
- Merge overlap (from product-spec review): peer 342-chart-series-palette edits
  `IndicatorPanels.tsx` / `indicatorChart.ts`; expect a textual conflict and a soft rebase order.

## Recommended Scope

Advisory; the debate decides.

Design fork to settle first — **where P and the FR-2 verdict come from**:

- **Option A, UI-only.** Fetch `W + P_max` bars, send all closes/times, tail-slice the response to
  W, derive FR-2 from `barsReturned < P`. No proto or analysis change. Needs a UI-side P per
  component (a second lookback table, DRY risk against `warmup.py`) and cannot know a custom
  formula's `warmup_period`.
- **Option B, additive proto.** UI still fetches and sends the longer series; analysis reports P
  (or an insufficient-history marker) per `ComponentSeries` (next free field 5) using
  `builtin_lookback_bars` / declared `warmup_period`, optionally trimming to a requested trailing
  window (request field 5). One P source for builtins and formulas; costs a proto step, buf-gen and
  the additive gate.
- Server-side bar re-fetch is not proposed: it reverses the recorded "no server re-fetch" contract.

Likely step boundaries:

1. (Option B only) proto: additive field(s) on `GetIndicatorSeries`; `buf lint` / `buf breaking` /
   `./scripts/buf-gen.sh`.
2. (Option B only) analysis: populate P / insufficient-history in `GetIndicatorSeries`; paired
   pytest in `TestGetIndicatorSeries` (C-08).
3. UI data: `loadBars` fetches window + prefix; chart draws the last W; hook sends the full series
   and returns a tail-aligned W-length result; vitest for the slice (AC-1, AC-3).
4. UI state: `IndicatorPanels` "Not enough history" per-component state, no series drawn, other
   components unaffected (AC-2, AC-4); canonical state primitives per C-17.
5. UI e2e: fixtures + INVENTORY rows, pane-state and request assertions in
   `position-detail.spec.ts`.
