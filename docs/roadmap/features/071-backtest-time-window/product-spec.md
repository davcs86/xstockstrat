# Product Spec: backtest-time-window

**Created**: 2026-07-26

---

## Problem Statement

`run_backtest` runs over a fixed rolling window that ends "today," with no way to specify the
period. This blocks temporal out-of-sample validation (you can vary symbols but not the date range,
so you cannot train on one window and test on a disjoint one) and makes results non-reproducible
across calendar days: the window start advances with the calendar, shifting the indicator warm-up,
so the same strategy on the same symbol yields slightly different trades on different run dates.

## User Story

As a quant validating a strategy or a tuned parameter, I want to run a backtest over an explicit
`start`/`end` window, so that results are deterministic across days and I can evaluate on a
held-out period (walk-forward / out-of-sample).

## Functional Requirements

FR-1. `run_backtest` MUST accept optional `start` and `end` (ISO date/datetime) parameters
delimiting the backtest window. When both are provided, the backtest covers exactly that window.
FR-2. When `start`/`end` are omitted, behavior MUST be unchanged (today's rolling-window default) —
backward compatible.
FR-3. When a window is given, the engine MUST load sufficient **pre-window history** so indicators
are already warm at `start` (e.g. a 20-bar z-score has ≥20 prior bars before the first in-window
bar), rather than beginning warm-up at `start` and delaying early signals. Pre-window bars are used
only to seed indicators; no trade may open before `start` and no future data beyond `end` may inform
any in-window bar (no look-ahead).
FR-4. Given identical `start`/`end` and data, `run_backtest` MUST return identical results
regardless of the calendar day it is invoked.
FR-5. The `run_backtest` MCP tool docstring and `docs/runbooks/mcp-tools.md` MUST document the new
parameters and the warm-up/no-look-ahead guarantee.

## Out of Scope

- Multiple disjoint windows in one call (single contiguous window only).
- Automated walk-forward orchestration (this feature enables it; a driver is separate).
- Changes to fills, sizing, or scoring math.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns the `RunBacktest` engine; implements windowing, pre-window warm-up
  history, and the no-look-ahead guarantee.
- `xstockstrat-agent` — the `run_backtest` MCP tool parameters and docstring.
- `xstockstrat-ui` — backtest trigger form / `BacktestDiagnostics`, only if the window is surfaced in
  the UI.
- `packages/proto` — additive `start`/`end` fields on the `RunBacktest` request.

## Proto Contract Changes

- [ ] No proto changes required
- Likely: add `start`/`end` (e.g. `google.protobuf.Timestamp` or ISO `string`) to the `RunBacktest`
  request message. Additive/backward-compatible; `buf breaking` must pass against the dev trunk.

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [ ] No schema changes — reads existing OHLCV history; requires only that coverage spans
  `start − warmup` … `end` (relates to backfill features 052–054/057).

## Feature Workflow Notes

Branch to create: `feature/backtest-time-window` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change) — not expected (additive fields)
- [ ] DBA review + service owner (schema migration) — not expected

## Acceptance Criteria

1. `run_backtest(..., start, end)` returns identical results regardless of the day it is invoked.
2. Indicators are valid from the first in-window bar (warm-up satisfied from pre-window history); no
   trade opens before `start`; no data after `end` influences any in-window bar.
3. Omitting `start`/`end` preserves current rolling-window behavior byte-for-byte.
4. A train/test split is expressible: fit a parameter on `[t0, t1]`, evaluate on `[t1, t2]`.
5. `run_backtest` docstring and `docs/runbooks/mcp-tools.md` document the parameters and guarantees.

## Open Questions

- [ ] Type for `start`/`end`: `google.protobuf.Timestamp` vs ISO `string` (match existing time
  fields in the analysis protos).
- [ ] If coverage is insufficient for the requested window + warm-up, fail loudly or auto-trigger a
  backfill (features 052–054/057)? Prefer a clear error over silent short data.
- [ ] **Known trap (ledger C-10 / 067):** adding request fields hard-couples shared consumers — the
  `run_backtest` MCP tool and any UI backtest trigger — which must be updated in the same feature
  with a test ("shipped the producer, forgot the shared consumer").
