# Product Spec: backtest-debug-info

**Created**: 2026-07-08

---

## Problem Statement

When a strategy author runs a backtest that returns **0 trades / 0% return** while market-data
coverage is sufficient (status `BACKTEST_STATUS_OK`, not `INSUFFICIENT_DATA`), the current UI shows
only aggregate metrics — all zeros — with no way to tell *why* the strategy never triggered. The
`RunBacktest` engine already computes everything needed to explain this (per-bar OHLCV, indicator
series, signal scores, entry/exit/conviction decisions) but discards it after simulating trades.
This feature exposes that per-bar diagnostic data so authors can debug non-triggering strategies.

## User Story

As a **strategy author**, I want the backtest run to surface full day-by-day diagnostics — a per-bar
table of OHLCV, every computed indicator series, warm-up markers, per-bar signal scores, and the
entry/exit/conviction decision the engine made each bar, plus a per-symbol summary of why no trade
fired — so that I can understand and fix a strategy that produced 0 trades even with sufficient data.

## Functional Requirements

FR-1. `RunBacktest` MUST return per-bar diagnostic data for every symbol it simulates, **always
included** in the response (no opt-in request flag). One diagnostic row per OHLCV bar processed.

FR-2. Each per-bar diagnostic row MUST include: symbol, bar index, bar timestamp, and the bar's
OHLCV values (open, high, low, close, volume) plus `vwap` when the source bar carries it.

FR-3. Each per-bar row MUST include the value of **every computed indicator/component series** at
that bar, keyed by series name:
- Legacy SMA-crossover path (`_backtest_symbol`): the fast and slow SMA series (e.g. `sma_fast`,
  `sma_slow`).
- Evaluator path (`_backtest_symbol_evaluated`): every `StrategyDefinition` component output series
  under the same naming the evaluator uses — bare `ref_name` for the primary `value` series and the
  dotted `<ref_name>.<series>` form for secondary series (e.g. `bb.upper`, `macd.signal`).
A series that has **not yet resolved** at a given bar (warm-up period) MUST be represented as absent
for that bar (not a fabricated `0`), so warm-up is unambiguous.

FR-4. Each per-bar row MUST carry a **warm-up marker** and the engine's **decision** for that bar,
expressed as a closed enum action (warm-up / hold-flat / enter-long / exit-long / hold-long) together
with the numeric `conviction` used and the per-bar `signal_score` (see FR-4a for its definition this
version). The warm-up marker is **rule-referenced** (resolved per OQ-1): a bar is warm-up when any
series that the strategy's active `entry_rule`/`exit_rule` reference is still unresolved at that bar —
**not** merely "any computed component unresolved," so an unused long-lookback component cannot mark
the whole range warm-up. The legacy SMA path (no rule trees) is warm-up until both the fast and slow
SMA have resolved (its rule-referenced specialization). The referenced-series set is derived from the
same rule-tree walk the evaluator already performs (`_validate_rule_refs`, union of entry+exit refs);
a position-aware refinement (entry refs gate while flat, exit refs gate while long) is a deferred
enhancement.

FR-4a. This version supports **no newsletter signals on the diagnostics-bearing paths beyond the
legacy signal-weighted mode** (resolved per OQ-4). The evaluator path passes no signals, so its
`signal_score` is always `0`; the legacy path reports the real per-bar `signal_score` only when the
strategy declares `signal_sources`. The field is retained for forward-compatibility and documented as
`0` when the strategy uses no signal sources.

FR-4b (**range cap — applies to ALL backtests, not just diagnostics**). `RunBacktest` MUST enforce a
maximum backtest range of **2 calendar years**, bounded by config key
`analysis.backtest.max_range_days` (int, default `730`). A request whose `range` span exceeds the cap
MUST be **rejected** with gRPC `INVALID_ARGUMENT` and a clear message stating the 2-year maximum and
the requested span — the engine does NOT silently clamp (preserves reproducibility; no "was-clamped"
response field needed). The `xstockstrat-ui` backtest form MUST constrain its Start/End date pickers
so a valid range cannot exceed the cap, and surface the same message if the backend rejects. This cap
bounds diagnostics to ≈504 daily rows/symbol, which resolves the always-included response-size concern
(OQ-2).

FR-5. Diagnostics MUST reflect exactly what the engine saw at bar *i* with **no look-ahead**: values
and markers at bar *i* derive only from bars `0..i` (preserving the evaluator's existing guarantee).

FR-6. When a symbol produced **0 trades**, the response MUST include a machine-readable per-symbol
**no-trade reason** (closed enum) distinguishing at least: entire range still in warm-up; entry
condition never satisfied; entry signalled but capital insufficient to fill. Symbols that traded
carry an "unspecified"/empty reason.

FR-7. Diagnostics MUST NOT be written into the ledger `analysis.backtest.completed` event payload —
that event keeps only its current summary metrics (append-only store must not be bloated).

FR-8. The `xstockstrat-ui` strategy detail page (`/insights/strategies/[id]`) MUST render the
diagnostics as a **day-by-day debug table** below the existing metrics grid whenever a result carries
diagnostics, with one column per OHLCV field, one column per indicator series, and columns for
warm-up / action / conviction. Warm-up rows and entry/exit rows SHOULD be visually distinguishable.
When a symbol has a no-trade reason, the UI MUST show it prominently (this is the primary answer to
"why 0 trades").

FR-9. The existing `INSUFFICIENT_DATA` gap flow (coverage-gap card + backfill button) MUST remain
unchanged; diagnostics are additive and apply to `BACKTEST_STATUS_OK` results (a symbol with
insufficient bars yields a coverage gap, not diagnostics).

## Out of Scope

- Any change to how trades are simulated, sized, or how metrics (Sharpe, drawdown, win rate, profit
  factor) are computed — diagnostics only observe the existing engine, they do not alter it.
- An opt-in / request-gated debug mode — the user explicitly chose always-included.
- Persisting diagnostics to a database or the ledger; diagnostics live only in the RPC response.
- Charting/visualizing the indicator series (beyond the tabular columns); the equity-curve chart is
  unchanged.
- Intraday timeframes — backtests run on the canonical `1d` timeframe today; this feature does not
  add new timeframes.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `packages/proto` — additive fields/messages on `analysis/v1/analysis.proto` (`BacktestResult`).
- `xstockstrat-analysis` — collect per-bar diagnostics in both backtest paths
  (`app/handlers/servicer.py` `_backtest_symbol`, `_backtest_symbol_evaluated`) and expose the
  evaluator's component series (`app/services/evaluator.py` currently returns only `BarDecision`);
  classify the per-symbol no-trade reason.
- `xstockstrat-ui` — render the debug table on `src/app/insights/strategies/[id]/page.tsx`
  (consumes the typed `BacktestResult` via `useRunBacktest`) and constrain the Start/End date pickers
  to the ≤2-year range cap (FR-4b).
- `xstockstrat-agent` — no functional change, but the `run_backtest` MCP tool response grows; verify
  it still serializes cleanly (`app/tools.py`, `app/client.py`).

## Proto Contract Changes

- [ ] No proto changes required
- **Additive, non-breaking** changes to `packages/proto/analysis/v1/analysis.proto` (final field
  numbers assigned at `/sdd-spec` time):
  - New enum `BarAction` (zero value `BAR_ACTION_UNSPECIFIED`; members for warm-up, hold-flat,
    enter-long, exit-long, hold-long).
  - New enum `NoTradeReason` (zero value `NO_TRADE_REASON_UNSPECIFIED`; members for
    entire-range-warmup, entry-never-true, insufficient-capital).
  - New message `BarDiagnostic` — `symbol`, `bar_index`, `timestamp`, `open`, `high`, `low`,
    `close`, `volume`, `vwap`, `map<string,double> indicators` (present series only), `bool warmup`,
    `double signal_score`, `double conviction`, `BarAction action`.
  - New message `SymbolDiagnostics` — `symbol`, `repeated BarDiagnostic bars`, `NoTradeReason
    no_trade_reason`, `int32 bars_total`, `int32 warmup_bars`.
  - `BacktestResult` gains `repeated SymbolDiagnostics diagnostics = <next-free-number>;`.
- Regenerate stubs via `./scripts/buf-gen.sh` (TS/Python/Go) and commit `packages/proto/gen/`.
- Passes `buf breaking` (additive only — no field removed, renumbered, or retyped).

## Config Key Changes

- One new config key, owned by `xstockstrat-analysis`:

| Key | Type | Default | Description |
|---|---|---|---|
| `analysis.backtest.max_range_days` | int | `730` | Maximum backtest range span in days (≈2 calendar years). Requests exceeding this are rejected with `INVALID_ARGUMENT`; applies to all `RunBacktest` callers. |

- Register per `docs/runbooks/config-rollout.md`, document in `services/xstockstrat-analysis/CLAUDE.md`
  (Config Keys Consumed) and the root CLAUDE.md recently-added-keys list.
- This is a **range cap** (resolves qq-2/OQ-2), not a per-symbol row cap and not an opt-in gate —
  consistent with the always-included diagnostics decision. It also bounds diagnostics to ≈504
  daily rows/symbol.

## Database Changes

- [x] No schema changes. Diagnostics are computed on the fly and returned in the RPC response only.

## Feature Workflow Notes

Branch to create: `feature/backtest-debug-info` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — additive proto + service work.
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive only).
- [ ] DBA review + service owner (schema migration) — N/A (no migration).
- Proto Reviewer sign-off required for the additive `analysis.proto` change (`buf lint`/`buf
  breaking` green).

## Acceptance Criteria

1. Running a backtest over a symbol with sufficient bars whose strategy never triggers returns
   `status = BACKTEST_STATUS_OK`, `total_trades = 0`, **and** a populated `diagnostics` entry for that
   symbol with one `BarDiagnostic` per bar and a non-`UNSPECIFIED` `no_trade_reason`.
2. Each `BarDiagnostic` reports the correct OHLCV for its bar, the indicator/component series values
   that had resolved by that bar (warm-up bars omit unresolved series and are flagged `warmup=true`),
   and an `action` consistent with the trade the engine did/didn't take.
3. For a strategy that *does* trade, the bar(s) where a trade opened/closed carry
   `action = ENTER_LONG` / `EXIT_LONG` and match the corresponding `TradeRecord` entry/exit times;
   `no_trade_reason` is unspecified for that symbol.
4. Diagnostics contain no look-ahead: a bar's series values and warm-up flag are identical whether the
   backtest range ends at that bar or extends beyond it.
5. The `analysis.backtest.completed` ledger event payload is unchanged (no diagnostics embedded).
6. The strategy detail page renders a day-by-day debug table below the metrics for an `OK` result,
   shows the no-trade reason when present, and leaves the `INSUFFICIENT_DATA` coverage-gap/backfill
   card behavior unchanged.
7. A `RunBacktest` request whose range span exceeds `analysis.backtest.max_range_days` (default 730)
   is rejected with `INVALID_ARGUMENT`; a request at or under the cap runs normally. The UI date
   pickers cannot submit a range wider than the cap.
8. `buf lint` and `buf breaking` pass; regenerated stubs are committed; `xstockstrat-analysis` and
   `xstockstrat-ui` test suites pass at their existing coverage thresholds.

## Open Questions

- [x] OQ-1 (**warm-up definition** — resolved 2026-07-08): warm-up is **rule-referenced** (Option B,
      union of entry+exit refs) — a bar is warm-up when a series the active rules reference is still
      unresolved, reusing the evaluator's existing rule-ref walk; the legacy SMA path is warm-up until
      both SMAs resolve. Rejected: Option A ("any component unresolved" — false-positives when an
      unused long-lookback component exists, misleading the exact debug case) and Option C ("declared
      lookback" — doesn't generalize to custom formulas). Position-aware refinement deferred. See
      FR-4. _(Confirm at /sdd-design if you prefer the simpler Option A.)_
- [x] OQ-2 (**response size** — resolved 2026-07-08 via qq-2): all backtests are capped to 2 calendar
      years (`analysis.backtest.max_range_days`, default 730), bounding diagnostics to ≈504 rows/symbol.
      Requests over the cap are rejected (FR-4b). UI table still virtualized for smoothness.
- [ ] OQ-3 (**agent tool**): confirm the `run_backtest` MCP tool's return mapping tolerates the larger
      response, or whether the agent should project diagnostics out of its tool result to keep agent
      context small (agent is read-through only; no functional change intended). Bounded by the 2-year
      cap; likely fine — verify during /sdd-spec.
- [x] OQ-4 (**signal_score** — resolved 2026-07-08 via qq-4): no newsletter signals in this version.
      `signal_score` stays `0` on the evaluator path and reflects real values only on the legacy
      signal-weighted path; the field is retained and documented as `0` otherwise. See FR-4a.
