# Context: unify-symbol-chart-libraries  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: The symbol page's OHLCV chart (lightweight-charts) and indicator panels (recharts) were consolidated onto a **single lightweight-charts v5 instance** using native multi-pane — candlestick in pane 0, one pane per chartable indicator, all sharing one time scale and one native crosshair with a unified tooltip readout. recharts was dropped from the symbol page only (kept for its 3 other consumers). What shipped is materially larger than the original "make the two charts line up" story: it became a **major-version v4→v5 upgrade + a new in-scope shared crosshair** because of a live user steer.

**Why (irrecoverable rationale)**: The scope jump is the key irrecoverable fact. At the live design gate the user said *"I don't want to keep both libraries. I want shared tooltips at some point."* — that single sentence, not any written requirement, is why (a) "keep both engines and sync them" was killed, (b) the team took the v4→v5 upgrade rather than the v4 synced-instances path, and (c) the shared crosshair/tooltip was pulled **into** this feature rather than deferred. Once design.md is deleted, a future agent seeing "v5 upgrade + crosshair" in a chart-unification feature will read it as scope creep; it was a deliberate, user-authorized forward investment toward eventual shared/compare tooltips.

**Rejected alternatives**:
- Keep both engines, sync them — lost: cross-engine tick algorithms only align to a tolerance, never by construction, and the getComputedStyle-in-hook token read would silently recolor the out-of-scope ChartPanel dashboard. **Rejected by the user** (this cleared the fails.md self-decided-chart-fork trap).
- Fork on lightweight-charts **v4** (synced N instances) — lost: v4.2.0 has no pane API, so alignment is "pinned-not-guaranteed" (minimumWidth is a floor, not a pin) and carries a re-entrancy/teardown bug class; v5 native panes make alignment a construction guarantee.
- Deferring the crosshair — the user chose to include it.

**Scars & gotchas**:
- **oklch tokens crash the canvas renderer, and the obvious fix does not work** (already at fails.md:1476). Load-bearing detail: current Chromium preserves the color space through *both* `getComputedStyle().color` and canvas `fillStyle` serialization, so only a 1×1-canvas pixel read-back down-converts. Only CI e2e caught it.
- **Sparse mock bars sit off-screen, so a hover/crosshair e2e never fires.** The shared-crosshair readout test silently never triggered until `chart.timeScale().fitContent()` was added after `setData`; it doubled as a real UX win. Reads as a gratuitous call in code.
- A 31-test CI red herring was environmental (a stale `.next` ChunkLoadError from overlapping local builds); a clean rebuild passed 42/42. Don't chase code for that failure signature.
- Chart e2e cannot go green on `pnpm dev` (a 10s/test cold-compile timeout on chart-heavy pages); red-first tests, full-green deferred to CI's prebuilt server throughout.
- A **new purpose-named `--chart-grid` token** was deliberately introduced rather than reusing `--border`, precisely because the theme's `--border` (`oklch(1 0 0 / 10%)`) is nearly invisible as a gridline on canvas. Once design/spec are gone, `globals.css` shows `--chart-grid` sitting next to `--border` with no recorded reason they diverge — a future agent restyling the chart could "simplify" back onto `--border` and silently near-erase the grid.

**Permanent deviations**:
- design/spec anticipated Step 7 would modify `ChartPanel.tsx` to migrate it to v5 → shipped **zero changes to ChartPanel.tsx** → it consumes only the hook's returned `containerRef`/`seriesRef` and never called v4 `addCandlestickSeries` directly, so Step 4's additive hook change carried the migration automatically. Once design.md is gone this reads as a missed step, not a deliberate no-op.
- The multi-pane layout **superseded** the card-per-panel framing feature 145 had just shipped for these panels — a deliberate layout reversal flagged for xstockstrat-ui owner review, not an accident.

**Cross-feature signal**: This closes the feature-123 recurring trap: the charting-library choice is a genuine architecture fork that had previously been self-decided by a subagent and overridden at the human gate. Here it was routed to a real `/sdd-design` human gate from the start, clearing the fails.md self-decided-chart-fork trap by precedent.

**Deferred follow-ons**: `/insights/market/[symbol]` and any other `useCandlestickChart` consumers were explicitly left on the old path; consolidating them is a named follow-up **if a shared chart primitive emerges** — note the recon finding that `insights/market/[symbol]` renders **no chart at all** despite prior CLAUDE.md claims, so a future "shared primitive" story should re-confirm that surface. Multi-symbol/compare crosshair infrastructure was kept out of scope; the unified readout is single-symbol only.

**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-26 entry. (The multi-pane-on-one-engine design and the oklch→canvas 1×1-read-back scar were already recorded at insights.md:1775 / fails.md:1476.)
**Runtime-invariant recommendations (→ /context-constitution)**: UI-* (borderline, partly in `services/xstockstrat-ui/CLAUDE.md` § Styling) — the symbol-page chart stack is now a single lightweight-charts v5 instance with native multi-pane; recharts is retained only for `EquityCurveChart`/`FormulaRunResult`/the insights page, and `useCandlestickChart` has exactly two real consumers (`ChartPanel.tsx` + symbol page).
**Scenario promotion (C-16)**: none — this feature has no `acceptance.feature` file.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
