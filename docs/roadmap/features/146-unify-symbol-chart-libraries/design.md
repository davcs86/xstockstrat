# Design: unify-symbol-chart-libraries

**Created**: 2026-08-18
**Rounds**: 2 (full; termination: approved). R1 debated fork (b) keep-both-engines; user steered to
fork (a) single-engine at the live gate; R2 debated fork (a) and resolved its v4-vs-v5 sub-fork.
**Approved by**: user @ 2026-08-18 (fork (a) at R1 steer; v5 + shared-crosshair-in-scope at R2 gate)
**Grounded in**: recon.md

---

## Chosen Approach

**Fork (a), on lightweight-charts v5 native panes.** Consolidate the symbol-page OHLCV price chart
and the indicator overlay panels onto a **single lightweight-charts v5 chart instance** with native
**multi-pane** layout, and remove `recharts` from `/trader/positions/[symbol]`. This **supersedes** the
CLAUDE.md sanctioned `lightweight-charts` exception (`services/xstockstrat-ui/CLAUDE.md:69-76`) — that
note previously kept only OHLCV on lightweight-charts and the panels on recharts; now both live on one
engine, so the exception is rewritten (and its stale "3 shared consumers / `insights/market/[symbol]`
renders a chart" claim is corrected in the same PR — that page renders no chart today, `recon.md:89-94`).

**Consumer surface (C-14):** UI `/trader` segment, the symbol page `#overview` section
(`page.tsx:382-401`). No new route.

**Structure.** One v5 chart instance owned in the overview section:
- **Pane 0** — the candlestick OHLCV series (migrated from v4 `addCandlestickSeries` to v5
  `addSeries(CandlestickSeries, …)` — the rename already flagged at `useCandlestickChart.ts:32-34`),
  plus the avg-cost / stop `createPriceLine` reference overlays unchanged (FR-5, `page.tsx:215-238`).
- **Panes 1..N** — one pane per **chartable** indicator component, each drawing its named sub-series
  (e.g. `macd.value/signal/histogram`) as line series (`IndicatorPanels.tsx:34-38, 79-90`).
- All panes share the chart's single **time scale** and a single **native crosshair**, so a vertical
  at bar D lines up across price and every indicator pane **by construction** — the residual
  price-scale-width drift of the N-separate-instances approach does not arise (one engine lays out all
  panes). This is the structural reason v5 was chosen over v4-synced-instances.

**Single bars fetch / parity (FR-4).** Unchanged: the page fetches bars once and already carries the
parity `times`/`closes` to the indicator side via `useIndicatorSeries` (`useIndicatorSeries.ts:10-28`,
`page.tsx:119-124, 203-208`). Panes are drawn from that same array — no second `GetBars`.

**Gaps not fabricated 0s (FR-3/AC-3).** An unset `IndicatorValue` maps to a lightweight-charts
**whitespace point `{ time }`** (time only, no `value`) so the line breaks across the gap; a genuine
`0` maps to `{ time, value: 0 }`. This preserves exactly today's `?? null` + `connectNulls={false}`
semantics (`IndicatorPanels.tsx:63-67, 88`). The unset→point mapper is extracted to `src/lib` as a
**pure, vitest-covered** function that also **normalizes/asserts strictly-ascending unique `time`**
(v5 `setData` throws on non-monotonic/duplicate time — a new crash surface the integer-index version
never had; the vitest test covers dup / out-of-order input).

**Per-component fault isolation (FR-3/AC-3).** A component with `comp.error` renders a **DOM error
strip** (as today, `IndicatorPanels.tsx:42-51`) and gets **no pane** — one failed component never
takes down the chart or the other panes.

**Shared crosshair/tooltip (FR-2 — in scope this feature).** The single v5 chart gives one native
crosshair across all panes; a unified tooltip reads every pane's series at the hovered time and renders
one combined readout (price + each indicator at bar D). This is the "shared tooltips" outcome, delivered
now rather than deferred, because the single-instance v5 model makes it native rather than cross-instance
wiring.

**Visual language / tokens (FR-2/AC-2).** All colors come from the existing `--chart-*` / theme tokens
(`globals.css:27-31, 107-111`; indicators already use `--chart-1..5` at `IndicatorPanels.tsx:19-25`).
The candlestick hook's hard-coded hex (`useCandlestickChart.ts:26-40`) and the avg-cost/stop overlay
hex (`page.tsx:219, 231`) move onto tokens. **Token→canvas-color resolution is a pure, vitest-covered
helper** (the app is dark-only with static `:root` values, so tokens resolve once): it must resolve
**oklch** tokens (`--chart-*`, `--border`, `--muted-foreground`) to `rgb()` via a probe-element
`getComputedStyle().color` round-trip before handing them to canvas; `--color-buy`/`--color-sell` are
already `hsl` and pass through. Gridline token is chosen for **real opacity** (not `--border` = 10%-alpha
white, which would near-erase gridlines) — pick/purpose-name a visible chart-grid token and eyeball it.
The unit-tested resolver is the **AC-2 objective backstop** (canvas fills are not DOM-inspectable, so a
DOM/snapshot check alone cannot prove "no off-token color").

**Hook / component shape.** `useCandlestickChart` is migrated to v5 and generalized into the price
pane of the shared chart; the indicator panes are created on the **same** chart instance (not a
sibling per-panel hook — that was the v4 plan). A small **pane/series coordinator** owns adding/removing
panes as the resolved strategy's components change (`IndicatorSection`, `page.tsx:1105-1163`), with
**disposal-safe teardown** mirroring `useCandlestickChart.ts:48-52` (remove series/panes on strategy
switch; never call into a disposed chart). The coordinator is scoped to **this feature's** pane +
crosshair/tooltip needs only — no speculative infra.

**Blast radius (minimal, not zero).** The v5 migration touches `useCandlestickChart.ts` and its other
consumer `ChartPanel.tsx` (dashboard, `page.tsx:7,39`) — both move to the v5 `addSeries` API and inherit
the hex→token colors; `chart-panel.spec.ts`'s `.tv-lightweight-charts` readiness signal
(`recon.md:98-101`) is preserved and re-verified. `recharts` stays in `package.json` and `ui/chart.tsx`
stays (3 other live consumers: `EquityCurveChart.tsx`, `FormulaRunResult.tsx`, `insights/page.tsx`) —
only the symbol page drops recharts.

**e2e (rewritten lock-step).** `position-detail.spec.ts:423-462` currently asserts recharts internals
(`.recharts-line` ×3, `indicator-panel`/`indicator-panel-error`, gap-not-0). Rewrite to: per-pane
readiness via the `.tv-lightweight-charts` canvas on the shared chart; series presence via a
`data-series` / `data-series-count` **readiness helper attribute** on each `indicator-panel` **plus** a
`setData`-invoked-N-times (or snapshot) seam — the attribute alone proves the prop, not the drawn
geometry, so it is explicitly **not** the AC-3 proof; the error panel stays DOM text; gap-not-0 is
proven by the wire-layer `test_analysis_servicer.py` unset-map test plus the vitest mapper test. No new
endpoint/env, so nothing new to mirror across `e2e/mock-backend.ts` + `playwright.config.ts`
`webServer.env` (confirm, don't add — `recon.md:106`). Verify statically (tsc/lint/prettier +
`playwright test --list` + one diagnosed run); defer full green to CI (chart-heavy cold-compile trap,
`fails.md`).

## Rejected Alternatives

- **Fork (b) — keep recharts + lightweight-charts, drive both from a shared time domain + tokens** —
  rejected by the user at the live gate ("I don't want to keep both libraries"); also cross-engine tick
  algorithms never align by construction (two layout engines), so AC-1 could only ever be tolerance-based.
- **Fork (a) on v4.2.0 with N synchronized chart instances (one per panel)** — rejected: v4 has no pane
  API, so alignment relies on a pinned price-scale width (`minimumWidth` is a floor, not a pin → drifts
  when label widths exceed it) plus a sync coordinator carrying re-entrancy (`isApplying`) and
  disposal-safe deregistration guards. v5 native panes remove that whole bug class and make AC-1 a true
  construction guarantee — worth the major-version bump given the user also wants the shared crosshair
  (native on one instance, cross-instance wiring on v4).
- **Defer the unified lockstep crosshair to a follow-up** — rejected by the user (chose "include in this
  feature"); it is nearly free on the single-instance v5 model, so it lands now.
- **Move OHLCV onto recharts instead** — rejected: recharts has no first-party candlestick geometry
  (`CLAUDE.md:69-76`).

## Open Risks

- [ ] **Multi-pane layout supersedes the card-per-panel framing (feature 145).** Today `IndicatorSection`
      renders indicator components as separate Cards (feature 145 wrapped `IndicatorPanels` in a Card).
      Stacked v5 panes on one chart replace that visual with a TradingView-style single instrument. This
      is the intended "one coherent instrument" outcome but it is a real layout change on top of 125/145
      — `/sdd-spec` must reconcile against post-125/145/139 state and it should get explicit
      `xstockstrat-ui` owner review. → `/sdd-spec` + owner review.
- [ ] **v5 API verification.** Confirm the resolved `lightweight-charts` v5 API for panes
      (`addPane`/`panes`/`paneIndex` or the v5 equivalent), `addSeries(CandlestickSeries|LineSeries)`,
      and line-series `WhitespaceData` (`{time}` no `value`) against the **installed** typings before
      building; **pin** the v5 version. `node_modules` was absent during recon so these are unverified.
      Update the root CLAUDE.md version note if the pin changes (`package.json:46`). → `/sdd-spec` step 0.
- [ ] **oklch→rgb canvas resolution** must be proven on the CI chromium (probe-element round-trip), and
      a visible gridline token chosen (not 10%-alpha `--border`). → token-resolver step (vitest + one
      diagnosed run).
- [ ] **AC-3 "all sub-series drawn" verification** on canvas: the `data-series-count` attribute is a
      readiness helper only; back it with a `setData`-invoked-N-times seam or a snapshot. → e2e-rewrite step.
- [ ] **Disposal-safe pane teardown on strategy switch** (`IndicatorSection` re-resolve,
      `page.tsx:1105-1163`) — no call into a disposed chart. → pane-coordinator step.
- [ ] **Rebase (soft).** 125/145/139 edit `page.tsx` / `IndicatorPanels.tsx`; re-verify every citation
      against post-125/145/139 state (no hard merge-order row). → `/sdd-spec`.

## Constitution Rules Touched

- **P-01/P-02/P-04** — honored: the charting-library fork and the v4-vs-v5 sub-fork were decided at a
  **live human gate** (proposer/adversary mediated by the orchestrator), not self-decided — directly
  clearing the `fails.md` L63-66 trap (121/122/123 self-decided chart forks overridden by the real user).
- **P-03 (no silent deviation/guess)** — honored: FR-2's crosshair clause is delivered in full (not
  silently under-delivered); AC-3's "drawn series" proof is explicitly **not** the prop-echo attribute;
  monotonic-time and oklch-resolution assumptions are surfaced as verify-at-spec risks, not guessed;
  unverified v5 APIs stay open risks (`F-04` — nothing invented).
- **C-14 (consumer surface)** — honored: the `/trader` symbol-page surface is named and its layout
  change (panes supersede cards) is called out for owner review, not left stale.
- **C-10 (integration completeness)** — honored: the CLAUDE.md sanctioned-exception text + the stale
  `insights/market/[symbol]` "3 consumers" doc-drift are corrected in the same PR; the shared
  `useCandlestickChart` hook's other consumer (`ChartPanel.tsx`) is migrated in lock-step.
- **C-12/C-13 (test-data inventory / no new fixtures)** — honored: reuse `INDICATOR_SERIES_AAPL`
  (`e2e/fixtures/indicatorSeries.ts`, `INVENTORY.md:32`) + inline AAPL bars-with-time
  (`mock-backend.ts:429-464`); no parallel fixture.
- **CLAUDE.md #2 "write the minimum"** — honored: the pane/crosshair coordinator is scoped to this
  feature's needs; no speculative infra for unbuilt surfaces.
- Proto **F-01/F-06/F-07**, config **C-05**, DB **C-07** — N/A (no proto/config/DB surface, `recon.md:76-83`).
