# Product Spec: walk-forward-backtesting

**Created**: 2026-05-26

---

## Problem Statement

The analysis service supports standard backtesting, but standard backtests overfit to the in-sample period — they measure how well the strategy would have traded the data it was tuned on, not how well it would trade unseen data. This produces optimistic performance estimates that routinely fail to materialize in live trading. There is currently no quantitative gate that distinguishes a genuinely robust strategy from a historically overfit one.

## User Story

As a platform operator, I want to run walk-forward validation on the strategy so that I can see how it performs on out-of-sample data and make a data-driven decision about whether to commit live capital.

## Functional Requirements

FR-1. The analysis service must expose a new `RunWalkForward(WalkForwardRequest) returns (WalkForwardResponse)` RPC.
FR-2. Walk-forward procedure: given a total historical window, split into N rolling periods. Each period has an in-sample window (for parameter fitting) and an immediately following out-of-sample window (for evaluation). Slide forward by one out-of-sample window length and repeat.
FR-3. Window sizes must be configurable per request: `in_sample_days`, `out_of_sample_days`, `total_window_days`.
FR-4. Per out-of-sample window, the response must include: window start/end dates, out-of-sample Sharpe ratio, out-of-sample win rate, out-of-sample total return, trade count.
FR-5. The response must also include aggregate statistics across all out-of-sample windows: mean Sharpe, worst-window Sharpe, consistency ratio (% of windows with Sharpe > 0).
FR-6. Walk-forward computation is strictly look-ahead-free: the in-sample window never overlaps with or references data after its end date, and parameter fitting uses only in-sample data.
FR-7. A "Run Walk-Forward" button in the insights UI triggers the RPC with configurable window parameters and displays results as a per-window bar chart (out-of-sample Sharpe per period) and the aggregate statistics table.
FR-8. Long-running walk-forward jobs (> 30 seconds) must stream progress updates back to the UI rather than blocking on a single response.

## Out of Scope

- Automated parameter optimization within each in-sample window (V1 uses fixed strategy parameters; walk-forward only evaluates them on rolling windows)
- Monte Carlo permutation testing
- Multi-strategy comparison in a single walk-forward run

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — new `RunWalkForward` RPC, rolling window loop calling existing backtest engine
- `xstockstrat-insights` — walk-forward trigger UI, progress streaming, results display

## Proto Contract Changes

- New RPC: `RunWalkForward(WalkForwardRequest) returns (stream WalkForwardProgressEvent)` in analysis proto
- `WalkForwardRequest`: `symbol`, `in_sample_days`, `out_of_sample_days`, `total_window_days`
- `WalkForwardProgressEvent`: oneof `progress` (window index, total windows) or `result` (WalkForwardResult with all per-window and aggregate stats)

## Config Key Changes

- `analysis.walkforward.max_total_window_days` — integer; cap on total historical window to prevent runaway queries (default: 1825 = 5 years)

## Database Changes

- [ ] No schema changes (reads from existing OHLCV and signal tables)

## Feature Workflow Notes

Branch to create: `feature/walk-forward-backtesting` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (analysis service + new proto RPC)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable (new RPC, non-breaking)
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. A walk-forward run with 252-day in-sample and 63-day out-of-sample windows over 3 years produces 8 out-of-sample windows with no overlap and no look-ahead.
2. Out-of-sample Sharpe for each window matches a hand-computed reference using the same date boundaries and fill prices.
3. The insights UI displays per-window Sharpe as a bar chart and aggregate stats within 5 seconds of job completion.
4. For a job taking > 30 seconds, progress updates appear in the UI (e.g., "window 3 of 8 complete") without a timeout.
5. Setting `total_window_days` above `max_total_window_days` returns a clear 400-equivalent error.

## Open Questions

- [ ] Should walk-forward results be persisted (written to a results table) or ephemeral (computed on demand, returned in stream)? Persisted results enable historical comparison of walk-forward runs over time. Decision deferred to impl-spec.
- [ ] gRPC server-streaming for progress vs. polling a job ID endpoint: server-streaming is cleaner but requires SSE or WebSocket bridging in the Next.js frontend. Confirm the insights UI's existing SSE infrastructure can support this. Deferred to impl-spec.
