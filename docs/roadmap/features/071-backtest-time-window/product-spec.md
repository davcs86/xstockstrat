# Product Spec: backtest-time-window

**Created**: 2026-07-26

---

## Problem Statement

The **`run_backtest` MCP tool** runs over a fixed rolling window that ends "today," with no way to
specify the period. This blocks temporal out-of-sample validation from the agent (you can vary
symbols but not the date range, so you cannot train on one window and test on a disjoint one) and
makes agent-run results non-reproducible across calendar days: the window start advances with the
calendar, shifting the indicator warm-up, so the same strategy on the same symbol yields slightly
different trades on different run dates.

**Scope correction (from review).** An explicit window already exists end-to-end at the RPC layer and
is already used by the UI:
- `analysis.proto:34` — `xstockstrat.common.v1.TimeRange range = 2;` on `RunBacktestRequest`;
- `servicer.py:273-297` — the servicer honors `request.range`, caps the span at
  `analysis.backtest.max_range_days`, and only defaults to a `now`-anchored trailing window when a
  bound is unset;
- `strategies/[id]/page.tsx:91` — the UI backtest form already sends `range: { start, end }`.

The unfilled gaps are therefore only:
1. **Agent surface** — `client.run_backtest` (`client.py:143-165`) builds a `RunBacktestRequest`
   with no `range`, and the tool (`tools.py:240-244`) exposes no window params.
2. **Pre-window warm-up (FR-3)** — genuinely new engine work. Today warm-up is consumed from
   *inside* the requested range (`servicer.py:628-629` SMA path; `servicer.py:821` /
   `_compute_evaluated_warmup` at `:949-984` evaluator path), and an all-warm-up range reports
   `NO_TRADE_REASON_ENTIRE_RANGE_WARMUP` (`servicer.py:1591-1597`).

## User Story

As a quant validating a strategy or a tuned parameter, I want to run a backtest over an explicit
`start`/`end` window, so that results are deterministic across days and I can evaluate on a
held-out period (walk-forward / out-of-sample).

## Functional Requirements

FR-1. The **`run_backtest` MCP tool** MUST accept optional `start` and `end` (ISO date/datetime)
parameters and plumb them into the existing `RunBacktestRequest.range` (`client.py:143-165` must
build a `common.v1.TimeRange`, as `client.py:706-712` already does for another RPC). When both are
provided, the backtest covers exactly that window. No new proto field is introduced.
FR-2. When `start`/`end` are omitted, behavior MUST be unchanged (today's rolling-window default) —
backward compatible.
FR-2a. **One-sided windows** MUST be supported and MUST match the servicer's existing semantics
(`servicer.py:289-297`): an unset bound (`seconds == 0`) is open and is defaulted — `end` unset →
`now`; `start` unset → `end − max_range_days`. This matches the existing agent precedent for
one-sided ranges (`client.py:705-712`).
FR-3. When a window is given, the engine MUST load sufficient **pre-window history** so indicators
are already warm at `start` (e.g. a 20-bar z-score has ≥20 prior bars before the first in-window
bar), rather than beginning warm-up at `start` and delaying early signals. Pre-window bars are used
only to seed indicators; no trade may open before `start` and no future data beyond `end` may inform
any in-window bar (no look-ahead).
FR-3a. The warm-up extension MUST NOT be defeated by the existing span cap: `max_range_days`
(default `730`, enforced at `servicer.py:276-287`) is validated against the **caller-requested**
window, while the `start − warmup … end` **fetch** span may legitimately exceed it. The design MUST
state explicitly which span the cap applies to.
FR-4. Given identical `start`/`end` and data, `run_backtest` MUST return identical results
regardless of the calendar day it is invoked.
FR-5. The `run_backtest` MCP tool docstring and `docs/runbooks/mcp-tools.md` (§`run_backtest`,
`:241-257` parameter table) MUST document the new parameters and the warm-up/no-look-ahead
guarantee.
FR-6. **Agent↔UI parity (C-10).** FR-3 is a server-side change, so it silently alters results for
the already-shipped UI backtest form (`strategies/[id]/page.tsx:91`) too. Both paths MUST produce
identical results for the same window, covered by a regression test. The design MUST also state
whether pre-window warm-up shifts previously persisted feature-065 evidence cells
(`backtest_run_symbols`) and, if so, whether existing cells are invalidated or left as-is.

FR-7. **Backtest/live parity (C-10).** The live evaluation loop is a *third* consumer of the same
shared evaluator: `app/engine/live_loop.py:116-121` (`_recent_range`) builds its own
`now`-anchored rolling window and `live_loop.py:133` calls the same `evaluator.evaluate(...)` the
backtest path reaches via `evaluate_with_series` (`servicer.py:818`). `services/xstockstrat-analysis/CLAUDE.md`
documents this shared evaluator as "guaranteeing backtest/live parity". The design MUST state
explicitly whether live evaluation is in scope for the FR-3 warm-up change:
- if warm-up moves **into the evaluator**, live evaluation changes too and that must be intended and
  tested;
- if warm-up is applied **only on the backtest path**, the documented parity invariant silently
  drifts and that divergence must be recorded.

Either answer is acceptable; leaving it unstated is not.

## Out of Scope

- Multiple disjoint windows in one call (single contiguous window only).
- Automated walk-forward orchestration (this feature enables it; a driver is separate).
- Changes to fills, sizing, or scoring math.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns the `RunBacktest` engine; implements pre-window warm-up history and
  the no-look-ahead guarantee. Windowing itself already exists (`servicer.py:273-297`).
- `xstockstrat-agent` — `run_backtest` MCP tool parameters and docstring (`tools.py:240-244`) and the
  `range` plumbing in `client.py:143-165`. **This is the only place the window is missing.**
- `xstockstrat-ui` — backtest trigger form / `BacktestDiagnostics`. **Unconditional**, not optional:
  the window is already surfaced (`strategies/[id]/page.tsx:91`), and the FR-3 warm-up change alters
  results for existing UI-triggered backtests (FR-6 parity).
- `packages/proto` — **no change**.

## Proto Contract Changes

- [x] No proto changes required
- `RunBacktestRequest.range` (`analysis.proto:34`, `common.v1.TimeRange`) already carries the window
  and is honored by the servicer. Adding `start`/`end` would create a second, ambiguous
  representation of one concept on a message whose wire bytes are **persisted verbatim** in
  `analysis.backtest_details` (`analysis.proto:60-63`), forcing a precedence question across the
  agent, UI, and persisted-detail replay paths. Rejected.

## Config Key Changes

- [x] No new config keys — **pending design confirmation** (see below).
- FR-3's warm-up lookback is exactly the kind of tunable that becomes a hardcoded literal
  (Constitution **F-07** breach) if not declared. The design MUST decide explicitly: derive it from
  the already-declared warm-up (`FormulaOutput.warmup_period` / `_compute_evaluated_warmup`,
  `servicer.py:949-984`), or register a key under `analysis.backtest.*`. Deriving it is preferred —
  it keeps one source of truth — but the decision must be recorded, not defaulted.

## Database Changes

- [x] No schema changes — reads existing OHLCV history; requires only that coverage spans
  `start − warmup` … `end` (relates to backfill features 052–054/057).

## Feature Workflow Notes

Branch to create: `feature/backtest-time-window` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — behavior change in `xstockstrat-analysis` + new agent tool params (no proto, no config)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, this feature makes no proto change
- [ ] DBA review + service owner (schema migration) — not expected

## Acceptance Criteria

1. `run_backtest(..., start, end)` from the **MCP agent** returns identical results regardless of the
   day it is invoked. *(Today the agent cannot pass a window at all.)*
2. Indicators are valid from the first in-window bar (warm-up satisfied from pre-window history); no
   trade opens before `start`; no data after `end` influences any in-window bar. *(Today warm-up is
   consumed from inside the range — `servicer.py:628-629`, `:949-984`.)*
3. Omitting `start`/`end` preserves current rolling-window behavior — **verified against a frozen
   clock**, i.e. the resolved range for the same invocation instant is unchanged. (Not
   "byte-for-byte" across days: the omit-range default is `now`-anchored by construction,
   `servicer.py:290-297`, so cross-day byte equality is impossible and is not the guarantee.)
4. A train/test split is expressible **from the MCP agent**: fit a parameter on `[t0, t1]`, evaluate
   on `[t1, t2]`, subject to the existing `max_range_days` cap (default `730` ≈ 2 years) per window.
   *(Already possible from the UI today — `strategies/[id]/page.tsx:91` — so the agent qualifier is
   what makes this discriminating.)*
4a. When history is insufficient to satisfy `start − warmup`, the run reports the shortfall
   explicitly (per OQ-1's resolution) rather than silently running with a shortened warm-up.
5. `run_backtest` docstring and `docs/runbooks/mcp-tools.md` (`:241-257`) document the parameters and
   guarantees.
6. The agent path and the UI path return identical results for the same window (FR-6 parity test).

## Open Questions

- [ ] **OQ-1 — Warm-up shortfall vs. coverage gap (design phase):** if history is insufficient for
  `start − warmup`, does the shortfall count as a `CoverageGap` and flip the run to
  `BACKTEST_STATUS_INSUFFICIENT_DATA` (the existing mechanism, `analysis.proto:44-58`), or is it
  reported separately? Prefer a clear error over silent short data; do not auto-trigger a backfill.
- [ ] **OQ-2 — Warm-up lookback source (design phase):** derived from declared warm-up, or a new
  `analysis.backtest.*` config key? See Config Key Changes (**F-07** risk).
- [ ] **OQ-3 — Feature-065 evidence cells (design phase):** does pre-window warm-up shift previously
  persisted `backtest_run_symbols` metrics, and if so are existing cells invalidated? See FR-6.
- [ ] **OQ-4 — Live-loop scope (design phase):** is the FR-3 warm-up change applied in the shared
  evaluator (changing live evaluation too) or only on the backtest path (diverging from the
  documented backtest/live parity invariant)? See FR-7.

**Resolved during review** (previously open):
- ~~Type for `start`/`end`: `Timestamp` vs ISO `string`?~~ **Moot** — the field already exists as
  `google.protobuf.Timestamp` via `TimeRange` (`common.proto:42-45`), and the UI already converts
  ISO → `{seconds, nanos}` (`strategies/[id]/page.tsx:79-82`). The MCP tool accepts ISO strings and
  converts, matching the UI.
- ~~Does `max_range_days` bind the requested window or the warm-up-extended fetch span?~~
  **Answered declaratively by FR-3a**: the cap binds the caller-requested window; the fetch span may
  exceed it. (Was previously listed as an open question that contradicted its own FR.)

## Risks / Known Traps

- **Ledger C-10 (fails 056/060/067) — "shipped the producer, forgot the shared consumer."** The real
  exposure is inverted from the original note: the UI is **already** wired, and the missing consumer
  is the **agent**. Separately, FR-3 is a server-side change that silently alters results for the
  already-shipped UI form and for feature-065 evidence cells — covered by FR-6.
- **Scope adjacency: feature 032 `walk-forward-backtesting`** (status `draft`). Its FR-2/FR-3/FR-6
  are a superset of this feature, and 071 names walk-forward orchestration as out of scope. 071 is
  effectively the substrate 032 would build on. No resource collision (032's
  `analysis.walkforward.max_total_window_days` key does not clash — 071 declares none), but the
  relationship should be confirmed rather than discovered later.
- **Persisted-run comparability.** `GetBacktest` (`analysis.proto:21`) replays runs persisted
  verbatim in `analysis.backtest_details` (feature 068). After FR-3 ships, the UI's Past Runs table
  will mix pre- and post-warm-up-change results with no marker distinguishing them. Not a
  correctness bug (old bytes are never recomputed), but a user-facing comparability issue the
  design should name alongside OQ-3.
- **Rebase-only overlap with feature 070** (`strategy-partial-update`, developed in parallel): shared
  files `analysis.proto`, `servicer.py`, `tools.py`, `client.py`, `insightsBff.ts`, `mcp-tools.md` —
  disjoint regions, no field-number/config/migration collision. Whichever merges second rebases.
