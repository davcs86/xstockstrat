# Product Spec: regime-segmented backtest

> **Rescoped 2026-08-29** (was "walk-forward-backtesting"). The original spec sold *overfitting
> detection via walk-forward optimization*, but its own Out-of-Scope removed parameter optimization
> and the platform has **no strategy-parameter optimizer** (`xstockstrat-analysis` runs strategies
> on fixed, hand-authored parameters — confirmed: no optimize/grid-search/tuning code exists). With
> nothing tuned on the in-sample window, "walk-forward" degenerated to running the existing backtest
> on rolling sub-windows — i.e. a **regime-segmented backtest**, not walk-forward. This spec is
> reframed to what it actually delivers, and true walk-forward is recorded as a future extension
> gated on an optimizer. The directory slug stays `032-walk-forward-backtesting` (numbering is
> immutable pre-launch churn we avoid), but the capability is a segmented backtest.

**Created**: 2026-05-26
**Rescoped**: 2026-08-29

---

## Problem Statement

The analysis service already supports a standard backtest **and** the platform can run a strategy
forward in **paper mode** (staging = paper, derived from environment). Between them, those cover
"how did it do over all of history, as one number" and "how is it doing forward, for real, right
now." Neither answers a third question that matters for a go-live decision: **was the strategy
*consistently* profitable across different historical market regimes, or is its single aggregate
Sharpe carried by one lucky stretch?**

- A **single** backtest collapses years into one aggregate number, hiding that a strategy might have
  been strongly profitable in a 2020-style rally and deeply negative in a 2022-style drawdown.
- **Paper mode** shows real forward performance but through exactly **one** regime — the one you are
  currently living through — and takes weeks-to-months to accumulate a meaningful sample.

There is currently no fast way to see performance **broken down by sub-period/regime** with
consistency statistics. That is the specific, non-redundant gap this feature fills.

## What this is *not* (to avoid the earlier confusion)

- **Not walk-forward optimization.** No parameters are fit on any window. Each window is an
  independent backtest of the *same* fixed strategy over a different date range. There is therefore
  **no in-sample/out-of-sample split** — that framing only has meaning when something is optimized
  in-sample, and nothing is.
- **Not an overfitting guard.** With no tuning, there is no optimization-induced overfitting to
  detect. (Real walk-forward — and the overfitting guard it provides — becomes meaningful only once
  the platform can optimize strategy parameters; see Future Extension.)

## User Story

As a platform operator, before I commit real (paper or live) capital to a strategy, I want to see
its performance segmented into rolling historical windows with per-window and aggregate consistency
statistics, so that I can tell a strategy that worked *everywhere* from one that worked in *one*
lucky regime — quickly, without waiting months for paper mode to sample a downturn.

## Functional Requirements

FR-1. The analysis service must expose a new `RunSegmentedBacktest(SegmentedBacktestRequest)` RPC
(server-streaming, see FR-8).

FR-2. Segmentation procedure: given a total historical window, partition it into evaluation windows
of `window_days`, advancing each window's start by `step_days`. `step_days == window_days` yields
consecutive non-overlapping windows; `step_days < window_days` yields overlapping rolling windows.
Each window is backtested **independently** with the strategy's existing fixed parameters.

FR-3. Window geometry must be configurable per request: `window_days`, `step_days`,
`total_window_days`.

FR-4. Per window, the response must include: window start/end dates, Sharpe ratio, win rate, total
return, and trade count — each computed **only** from data inside that window.

FR-5. The response must include aggregate statistics across all windows: mean Sharpe,
**worst-window Sharpe**, **consistency ratio** (% of windows with Sharpe > 0), and **Sharpe
dispersion** (stdev across windows — a direct regime-robustness measure).

FR-6. Each window is strictly self-contained: a window's metrics reference no bar or signal dated
outside `[window_start, window_end]`. (Trivially satisfied because each window is an independent
historical backtest — stated so acceptance testing verifies no accidental cross-window leakage,
e.g. an indicator warm-up reaching into a prior window.)

FR-7. A "Run Segmented Backtest" action in the insights UI triggers the RPC with configurable window
parameters and displays results as a per-window bar chart (Sharpe per window, colored by sign) plus
the aggregate-statistics table.

FR-8. Long-running jobs (> 30 seconds) must stream progress updates back to the UI ("window 3 of 8
complete") rather than blocking on a single response.

## Out of Scope

- **Any parameter optimization / fitting** (this is what made "walk-forward" a misnomer). Deferred to
  the Future Extension below.
- Monte Carlo permutation testing.
- Multi-strategy comparison in a single run.
- Persisting results for historical comparison across runs (open question below — default ephemeral).

## Future Extension — true walk-forward (gated on an optimizer)

This feature becomes genuine walk-forward **only** if the platform later gains a strategy-parameter
optimizer. At that point: re-introduce an in-sample slice preceding each evaluation window, fit
parameters on the in-sample slice, evaluate on the (now truly out-of-sample) window, and the
in-sample→out-of-sample performance gap becomes the overfitting signal. The RPC could then gain an
optional `optimize: bool` / `in_sample_days` field. **Do not build the in-sample plumbing now** —
there is nothing to optimize, so it would be dead scaffolding (CLAUDE.md "How to Act" #2).

## Affected Services

- `xstockstrat-analysis` — new `RunSegmentedBacktest` RPC; rolling-window loop calling the **existing
  backtest engine** once per window.
- `xstockstrat-ui` (insights segment) — trigger UI, progress streaming, results display.

## Proto Contract Changes

- New RPC: `RunSegmentedBacktest(SegmentedBacktestRequest) returns (stream SegmentedBacktestProgressEvent)`
  in the analysis proto (non-breaking addition).
- `SegmentedBacktestRequest`: `symbol`, `strategy_id`, `window_days`, `step_days`, `total_window_days`.
- `SegmentedBacktestProgressEvent`: `oneof` of `progress` (window index, total windows) or `result`
  (`SegmentedBacktestResult` with all per-window rows and aggregate stats).

## Config Key Changes

- `analysis.segmentedbacktest.max_total_window_days` — integer; cap on total historical window to
  prevent runaway queries (default: `1825` = 5 years).

## Database Changes

- [x] No schema changes (reads existing OHLCV and signal tables). Result persistence is out of scope
  for V1 (see Out of Scope / Open Questions).

## Feature Workflow Notes

Branch to create: `feature/walk-forward-backtesting` (slug unchanged; branch from `main-dev`).
Approval gates (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (analysis service + new proto RPC)
- [ ] 2 service owners + platform lead (breaking proto) — not applicable (new RPC, non-breaking)
- [ ] DBA review — not applicable (no schema change)

## Acceptance Criteria

1. A run with `window_days=63`, `step_days=63`, `total_window_days` = 3 years produces ~12
   consecutive non-overlapping windows with no gaps and no cross-window data leakage.
2. A run with `step_days < window_days` produces the expected number of overlapping rolling windows.
3. Per-window Sharpe for each window matches a hand-computed reference using the same date boundaries
   and fill prices.
4. Aggregate stats (mean / worst-window Sharpe, consistency ratio, dispersion) match a reference
   computed from the per-window rows.
5. The insights UI displays per-window Sharpe as a sign-colored bar chart and the aggregate table
   within 5 seconds of job completion.
6. For a job taking > 30 seconds, progress updates appear in the UI without a timeout.
7. Setting `total_window_days` above `max_total_window_days` returns a clear 400-equivalent error.

## Open Questions

- [ ] Persist results (results table, enables cross-run comparison over time) vs. ephemeral
      (computed on demand, streamed). Default **ephemeral** unless impl-spec finds a cheap persist.
- [ ] gRPC server-streaming for progress vs. polling a job-ID endpoint — confirm the insights UI's
      existing SSE infrastructure supports the stream bridge. Deferred to impl-spec.
