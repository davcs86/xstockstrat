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

FR-3. The insufficient-data outcome MUST be machine-readable so the UI/agent can render a clear
message and (ideally) offer a one-click / one-call "backfill this range" action that issues the
existing `TriggerBackfill` RPC. (Wiring the actual UI button may be a follow-up; the contract must
support it.)

FR-4. Normalize the timeframe vocabulary so backfill and backtest speak the same language. Either
introduce a shared timeframe enum (preferred per the repo's "prefer enums" proto governance) or
converge on one canonical string and translate at the edges. `"1d"` (backfill) and `"1Day"`
(backtest's `GetBars` call) MUST no longer be able to silently miss each other.

FR-5. `GetDataCoverage` MUST be exposed to the MCP agent (a new agent tool or an extension of an
existing one) so the AI agent can check coverage before proposing a backtest. _(Confirm scope at
/sdd-spec time; may be deferred to keep this feature backend-only.)_

## Out of Scope

- Durability / observability of backfill jobs — that is **P0** (`durable-observable-backfills`).
- "Fill only the gaps" backfill execution — that consumes `GetDataCoverage` but is **P2**
  (`resumable-chunked-backfills`). This feature only provides the coverage *query*.
- Changing the backtest engine's strategy logic (SMA crossover) or scoring.
- Auto-triggering a backfill from inside `RunBacktest` (we return the gap; we do not silently
  fetch — that would hide cost and latency from the caller).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-marketdata` — owns `GetDataCoverage`; owns the canonical timeframe definition.
- `xstockstrat-analysis` — `RunBacktest` returns structured insufficient-data; consumes coverage
  and/or the normalized timeframe.
- `xstockstrat-agent` — (optional, FR-5) exposes coverage to the AI agent.
- `xstockstrat-ui` — (downstream consumer) renders the insufficient-data message / backfill action;
  may be a follow-up rather than in this feature.

## Proto Contract Changes

- [ ] No proto changes required
- **Changes required:**
  - `packages/proto/marketdata/v1/marketdata.proto` — new `rpc GetDataCoverage(...)` + request/response
    messages (covered ranges, bar count). Additive → non-breaking.
  - `packages/proto/analysis/v1/...` — extend the backtest response with a structured
    insufficient-data variant (e.g. a `coverage_gap` message / status enum). Prefer **additive**
    fields to stay non-breaking; if the existing response shape can't express it cleanly, evaluate a
    v2 per `docs/runbooks/proto-versioning.md` (avoid if possible).
  - Timeframe enum (FR-4): if introduced, lives in `common/v1` or `marketdata/v1`. Adding an enum +
    new fields is additive; **changing existing string fields to enum is breaking** — needs the
    deprecation path. Decide approach at /sdd-spec time.

## Config Key Changes

- [x] No new config keys (coverage is derived from the existing `marketdata.ohlcv` hypertable).

## Database Changes

- [x] No schema changes — `GetDataCoverage` is a read query (`MIN/MAX(time)`, `COUNT(*)`,
  gap detection) over the existing `marketdata.ohlcv` hypertable. Verify a supporting index on
  `(symbol, timeframe, time)` already exists; if not, an index-only migration may be added.

## Feature Workflow Notes

Branch to create: `feature/backfill-backtest-coverage` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto change) — marketdata + analysis owners
- [ ] 2 service owners + platform lead (only if a breaking proto change / v2 is chosen for FR-4)
- [ ] DBA review + service owner (only if a coverage-supporting index migration is added)

## Acceptance Criteria

1. `GetDataCoverage("AAPL", "1d")` returns the actual covered range and bar count from
   `marketdata.ohlcv`, and reports gaps for a symbol with a hole in its history.
2. A backtest over a range with no/insufficient bars returns a structured result naming the
   missing range and `bars_have` / `bars_need` — not a flat-equity success.
3. A backfill issued with the backfill vocabulary and a backtest issued with the backtest
   vocabulary operate on the **same** stored bars (no `"1d"` vs `"1Day"` miss) — proven by a test
   that backfills then immediately backtests the same symbol/timeframe and gets non-empty results.
4. (If FR-5 in scope) the MCP agent can query coverage before proposing a backtest.

## Open Questions

- [ ] Timeframe normalization: shared enum (cleaner, but touches existing string fields → breaking
      unless additive) vs. canonical string + edge translation (non-breaking, less clean)?
- [ ] Should `RunBacktest` return the gap as a soft result (status field) or as a gRPC error with
      details? Soft result is friendlier for partial multi-symbol backtests.
- [ ] Is FR-5 (agent tool for coverage) in this feature, or a thin follow-up?
- [ ] Does the UI "one-click backfill" land here or as a separate UI feature consuming this contract?
