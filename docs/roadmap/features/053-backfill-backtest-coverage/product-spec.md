# Product Spec: backfill-backtest-coverage

**Created**: 2026-06-08
**Priority Bucket**: P1 — Close the backfill↔backtest loop

---

## Problem Statement

The entire point of a backfill is to feed backtests, yet the two are blind to each other. When
`RunBacktest` (`services/xstockstrat-analysis/app/handlers/servicer.py`) fetches OHLCV via
`MarketDataService.GetBars` and gets too few bars (`len(bars) < slow_period + 2`), it returns a
flat-equity no-op with only a `log.warning` — the caller (UI / MCP agent) sees an "empty" backtest
with no explanation. There is also no way to ask "what data do I actually have for AAPL@1d?" before
running, and the timeframe vocabulary mismatches across services (backfill uses `"1d"`; the backtest
engine queries marketdata with `"1Day"`), a latent silent-failure bug.

## User Story

As a **strategy analyst running a backtest**, I want the system to tell me when it lacks the price
history my date range needs — and what to backfill to fix it — so that an empty backtest is an
actionable message, not a mystery.

## Functional Requirements

FR-1. Add a `GetDataCoverage` RPC to `xstockstrat-marketdata` that, given `symbol` + `timeframe`
(+ optional `range`), returns the covered time range(s) and bar count actually present in
`marketdata.ohlcv`. This is the missing primitive behind both "do I need to backfill?" and (P2)
"fill only the gaps".

FR-2. `RunBacktest` MUST return a **structured insufficient-data outcome** when coverage is too thin
for the requested range/parameters — including: requested range, bars available, bars required
(e.g. `slow_period + 2`), and the gap range to backfill. It MUST NOT return a fabricated
flat-equity series as if the backtest "ran".

FR-3. The insufficient-data outcome MUST be machine-readable (gap range, `bars_have`, `bars_need`,
`symbol`, `timeframe`) so a caller can act on it programmatically — this is the contract that FR-6
and the (deferred) agent tool consume.

FR-6. **In scope** (decision: UI in scope — sdd-review 2026-06-08). The `xstockstrat-ui` backtest
view MUST surface the FR-2/FR-3 insufficient-data result as a clear message and offer a **"backfill
this range" action** that issues the existing `TriggerBackfill` RPC for the reported gap
(`symbol`, `timeframe`, gap `range`) through the UI's BFF → backend call chain (per
`docs/patterns/frontend-auth.md`, forwarding `x-user-id` / `x-access-scope` / `x-trace-id`). After
triggering, the UI MUST give the operator feedback (the returned `job_id` and a confirmation);
**live progress display** of the resulting job is a soft enhancement that depends on P0
(`durable-observable-backfills`, for reliable `bars_total`/status) and may follow.

FR-4. Normalize the timeframe vocabulary via a **shared proto enum** (decision: shared enum, per the
repo's "prefer enums" governance — sdd-review 2026-06-08). Introduce a `Timeframe` enum (with the
mandatory `TIMEFRAME_UNSPECIFIED = 0` sentinel) in `common/v1`, and migrate the existing string
`timeframe` fields on the backfill and `GetBars` paths to it. `"1d"` (backfill) and `"1Day"`
(backtest's `GetBars` call) MUST no longer be able to silently miss each other. **This is a breaking
proto change** — see Proto Contract Changes and Feature Workflow Notes for the deprecation path and
elevated approval gate.

FR-5. _(Deferred — out of scope for this feature; decision sdd-review 2026-06-08.)_ Exposing
`GetDataCoverage` to the MCP agent as a tool is a thin follow-up that consumes this contract. This
feature stays backend-only (`marketdata` + `analysis`). Tracked for a later agent-tool feature.

## Out of Scope

- Durability / observability of backfill jobs — that is **P0** (`durable-observable-backfills`).
- "Fill only the gaps" backfill execution — that consumes `GetDataCoverage` but is **P2**
  (`resumable-chunked-backfills`). This feature only provides the coverage *query*.
- Changing the backtest engine's strategy logic (SMA crossover) or scoring.
- Auto-triggering a backfill from inside `RunBacktest` (we return the gap; we do not silently
  fetch — that would hide cost and latency from the caller).
- Exposing `GetDataCoverage` as an MCP agent tool (FR-5, deferred to a follow-up).
- **Live progress display** of a triggered backfill job in the UI — the FR-6 button fires
  `TriggerBackfill` and confirms the `job_id`, but rendering live `bars_processed / bars_total`
  progress depends on P0 (`durable-observable-backfills`) and is a soft follow-up, not required here.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` — owns `GetDataCoverage`; owns the canonical timeframe definition.
- `xstockstrat-analysis` — `RunBacktest` returns structured insufficient-data; consumes coverage
  and/or the normalized timeframe.
- `xstockstrat-agent` — (deferred, FR-5) would expose coverage to the AI agent; not in this feature.
- `xstockstrat-ui` — **in scope (FR-6)**: backtest view renders the insufficient-data message and the
  "backfill this range" action, calling `TriggerBackfill` via the BFF call chain
  (`docs/patterns/frontend-auth.md`). Requires a Playwright E2E covering the gap-message + button.

## Proto Contract Changes

- [ ] No proto changes required
- **Changes required:**
  - `packages/proto/marketdata/v1/marketdata.proto` — new `rpc GetDataCoverage(...)` + request/response
    messages (covered ranges, bar count). Additive → non-breaking.
  - `packages/proto/analysis/v1/...` — extend the backtest response with a structured
    insufficient-data variant (e.g. a `coverage_gap` message / status enum). Prefer **additive**
    fields to stay non-breaking; if the existing response shape can't express it cleanly, evaluate a
    v2 per `docs/runbooks/proto-versioning.md` (avoid if possible).
  - `packages/proto/common/v1/common.proto` — new `Timeframe` enum (FR-4) with
    `TIMEFRAME_UNSPECIFIED = 0`. **Migrating existing string `timeframe` fields to the enum is a
    breaking change** → follow the deprecation path in `docs/runbooks/proto-versioning.md`: add the
    enum field alongside the deprecated string field for one release cycle, with a deprecation
    comment, before removing the string. `buf breaking` will flag the eventual removal — gated by the
    elevated approval below.

## Config Key Changes

- [x] No new config keys (coverage is derived from the existing `marketdata.ohlcv` hypertable).

## Database Changes

- [x] No schema changes — `GetDataCoverage` is a read query (`MIN/MAX(time)`, `COUNT(*)`,
  gap detection) over the existing `marketdata.ohlcv` hypertable. Verify a supporting index on
  `(symbol, timeframe, time)` already exists; if not, an index-only migration may be added.

## Feature Workflow Notes

Branch to create: `feature/backfill-backtest-coverage` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto change) — superseded by the breaking gate below
- [x] **2 service owners + platform lead** — the `Timeframe` enum migration (FR-4) is a breaking
  proto change (see `docs/runbooks/approval-flow.md`); requires marketdata + analysis owners + the
  platform lead, plus a one-release deprecation cycle.
- [ ] DBA review + service owner (only if a coverage-supporting index migration is added)

## Acceptance Criteria

1. `GetDataCoverage("AAPL", "1d")` returns the actual covered range and bar count from
   `marketdata.ohlcv`, and reports gaps for a symbol with a hole in its history.
2. A backtest over a range with no/insufficient bars returns a structured result naming the
   missing range and `bars_have` / `bars_need` — not a flat-equity success.
3. A backfill issued with the backfill vocabulary and a backtest issued with the backtest
   vocabulary operate on the **same** stored bars (no `"1d"` vs `"1Day"` miss) — proven by a test
   that backfills then immediately backtests the same symbol/timeframe and gets non-empty results.
4. In the UI, a backtest over an uncovered range shows the insufficient-data message and a "backfill
   this range" action; clicking it issues `TriggerBackfill` for the reported gap and confirms the
   `job_id` — covered by a Playwright E2E (FR-6).

## Resolved Decisions

_(Resolved during /sdd-review product-spec, 2026-06-08.)_

- [x] **Timeframe normalization**: shared `Timeframe` proto enum in `common/v1` (FR-4). Accepted as a
      breaking proto change with a one-release deprecation cycle and the elevated approval gate above.
- [x] **Insufficient-data signaling**: `RunBacktest` returns a **soft structured result** (status +
      `coverage_gap` detail), not a gRPC error — friendlier for partial multi-symbol backtests where
      some symbols have data and others don't.
- [x] **Agent tool (FR-5)**: deferred — out of scope; a thin follow-up feature will expose
      `GetDataCoverage` to the MCP agent. This feature stays backend-only.
- [x] **UI "one-click backfill"**: **in scope** (FR-6) — the `xstockstrat-ui` backtest view renders
      the gap message and a "backfill this range" button that fires `TriggerBackfill` via the BFF
      chain, with a Playwright E2E. Live job-progress display remains a soft follow-up dependent on
      P0. _(Revised from the initial "out of scope" decision at user request.)_
