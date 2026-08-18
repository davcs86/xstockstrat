# Product Spec: unify-symbol-chart-libraries

**Created**: 2026-08-18

---

## Problem Statement

On the trader symbol page (`/trader/positions/[symbol]`), the OHLCV price chart and the indicator
overlay panels beneath it look like two different systems: the price chart renders via
`lightweight-charts` (TradingView-style, a visible date x-axis, its own gridlines/tooltip) while the
indicator panels render via `recharts` (shadcn `ui/chart`, a hidden index x-axis, different
gridlines/tooltip). They are meant to be x-axis parity-aligned over the same bars but present
inconsistently, so a trader reading price + indicators together sees a disjoint instrument. PR #980
harmonized the panels' card framing but deliberately left the charting-library mismatch untouched.

## User Story

As a trader reading a symbol's price action alongside its strategy indicators, I want the OHLCV chart
and the indicator panels to share one aligned time axis and a single visual language, so that I can
read price and indicators as one coherent instrument instead of two mismatched charts.

## Functional Requirements

FR-1. On the symbol page overview section, the OHLCV price chart and every indicator panel MUST share
      a single, visually aligned **time x-axis** (same date domain, same tick positions / left-edge
      alignment), so a vertical line at one bar lines up across price and all indicator panels.
FR-2. The two chart surfaces MUST present a **consistent visual language**: matching gridline style,
      axis tick typography, crosshair/tooltip behavior, series color tokens (the existing
      `--chart-*` / theme tokens), and panel height rhythm.
FR-3. Indicator series MUST keep their current correctness guarantees unchanged: one panel per
      declared strategy component, every named sub-series drawn (e.g. `macd.value/signal/histogram`),
      per-component fault isolation (a failed component shows its error, never a chart), and warm-up /
      gap values rendered as gaps — never fabricated `0`s (AC-4a / P-03, feature 125).
FR-4. The unified presentation MUST preserve the current x-axis parity contract (feature 125, FR-6):
      indicator series are charted over the exact bars the candlestick drew, from the page's single
      bars fetch — no second `GetBars` call, no re-fetch.
FR-5. The unification MUST NOT regress the price chart's existing reference overlays (avg-cost and
      stop dashed price lines) or its held/unheld-symbol behavior (chart renders for any symbol).
FR-6. The design phase MUST decide, and record via a human gate, the charting-library strategy —
      **(a)** move the indicator series into `lightweight-charts` panes/overlays sharing the price
      chart's time scale, **(b)** keep both libraries but drive them from one shared time domain +
      shared theme tokens, or **(c)** another approach — and whether this **revisits or upholds** the
      CLAUDE.md sanctioned exception that keeps OHLCV on `lightweight-charts`. This is a genuine
      architecture fork (see Known Trap below); it must not be silently self-decided.

## Out of Scope

- The `/insights/market/[symbol]` chart and any other `useCandlestickChart` consumer — this feature
  scopes the **trader symbol page** only. If the design chooses a shared hook/primitive that those
  siblings could adopt, migrating them is a **named follow-up**, not part of this feature.
- Adding new indicator types, new timeframes, or new chart interactions (zoom/drawing tools) beyond
  what renders today.
- Replacing `recharts` elsewhere in the app (screener, strategy analytics, backfills, etc.).
- Backend/proto/analysis changes — the series data contract (`ComponentSeries` / `IndicatorValue`)
  is unchanged.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — the only service changed: `src/app/trader/positions/[symbol]/page.tsx`
  (`SymbolPriceChart` + `IndicatorSection`), `src/components/trader/IndicatorPanels.tsx`,
  `src/hooks/useCandlestickChart.ts`, and possibly a new/shared chart primitive.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: the symbol page (`/trader/positions/[symbol]`)
      overview section — the OHLCV price chart + indicator panels render with a shared aligned time
      axis and consistent styling. No new route; this refines an existing, already-registered page.
- [ ] **Agent** — none.
- [ ] **None** — not applicable (this is a user-facing UI presentation change).

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/unify-symbol-chart-libraries` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (`xstockstrat-ui`) — no proto/config/schema change; UI-only
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. On `/trader/positions/[symbol]` with a resolved strategy that has chartable components, the price
   chart and each indicator panel share one aligned time x-axis: the same date domain, and a bar at
   date D lines up vertically across the price chart and every indicator panel.
2. The price chart and indicator panels use a consistent visual language (gridlines, axis tick
   typography, crosshair/tooltip, `--chart-*`/theme color tokens, height rhythm) — no two-systems look.
3. Indicator correctness is unchanged: one panel per component, all named sub-series drawn, a failed
   component shows its error (no chart), warm-up/gap values render as gaps (no fabricated 0s).
4. No second bars fetch is introduced — indicator series are still charted over the page's single
   `GetBars` result (x-axis parity preserved).
5. Price-chart reference overlays (avg cost, stop) and held/unheld-symbol rendering are unchanged.
6. Existing e2e for the symbol page and `chart-panel.spec.ts` pass; the chart-readiness signal the
   e2e depends on still exists (or the test is updated in lock-step with justification), and any new
   test-support wiring is mirrored across sibling files (mock-backend + playwright webServer env).

## Open Questions

- [ ] **Charting-library strategy (genuine architecture fork — human gate required).** Does the
      indicator series move onto `lightweight-charts` panes (single time scale, deepest visual unity,
      but reimplements the recharts line/tooltip/gap rendering and touches the shared
      `useCandlestickChart` hook), or do both libraries stay and get driven from one shared time
      domain + theme tokens (smaller blast radius, but two rendering engines to keep in sync)?
      **Known trap (ledger fails.md, 2026-08-08 `feature-123`):** the charting-library decision was
      previously self-decided by a subagent debate and later overridden by the human gate — resolve
      this in `/sdd-design` with a real proposer/adversary round and an explicit user decision, and
      record whether it upholds or revisits the CLAUDE.md sanctioned `lightweight-charts` exception.
- [ ] **`chart-panel.spec.ts` readiness dependency (ledger fails.md, ~L232-234).**
      `e2e/trader/chart-panel.spec.ts` uses `lightweight-charts`' injected `.tv-lightweight-charts`
      DOM class as an async-readiness signal. If the price chart changes, that signal must be
      preserved or the test rewritten to a new deterministic signal — decide during design/spec.
- [ ] **Sibling test-support wiring (ledger fails.md, 2026-08-05 `014-trader-chart-panel`).** If the
      change needs new mock/env wiring, mirror it across `e2e/mock-backend.ts` **and**
      `playwright.config.ts` `webServer.env` (and warmup routes) — a past chart feature missed the
      sibling file.
- [ ] **Local e2e cold-compile (ledger fails.md, `new-page E2E`).** Verify statically
      (tsc/lint/prettier + one diagnosed run) locally and defer the full green run to CI's prebuilt
      server — a cold `pnpm dev` 10s/test timeout cannot be relied on for chart-heavy routes.
- [ ] Does the design introduce a shared chart primitive/hook that `/insights/market/[symbol]` should
      later adopt? If so, name the follow-up rather than widening this feature's scope.
