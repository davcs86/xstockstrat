# Product Spec: fix-backtest-silent-symbol-skip

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-15-backtest-silent-symbol-skip-reports-ok-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-22

---

## Problem Statement

**Observed.** On staging (deployment `63d315a4`, image `a8a3cfd`),
`run_backtest(squeeze_breakout_trend, ["AAPL"], start="2026-01-01", end="2026-09-30")` returned backtest
`df5d966f-f9cb-4e77-b095-6af56908f36a` with `status: BACKTEST_STATUS_OK`, `total_trades: 0`, `diagnostics: []`,
`coverage_gaps: []` and `warnings: []`. AAPL has ≥ 501 stored daily bars. The same strategy on SCHD (3 stored bars)
gave the same shape (`d7892362-deb7-4c2b-88a9-abf679b7dfb1`) with no coverage gap. The analysis log shows the real
cause for every run: `backtest symbol <SYM> failed: <AioRpcError … PERMISSION_DENIED "admins cannot execute another
user's formula"> — skipping`.

Code on `main-dev` `6923e95a` (`services/xstockstrat-analysis`), unchanged in substance since the report:

- **The silent skip.** In the `RunBacktest` symbol loop, `except grpc.RpcError` (`app/handlers/servicer.py:1127-1129`)
  and `except Exception` (`:1130-1132`) each `log.warning(...)` and `continue`. They append no `SymbolDiagnostics`,
  no coverage gap and no warning, and touch none of the gate counters. The sibling `except FormulaExecutionError`
  (`:1112-1126`) appends `NO_TRADE_REASON_FORMULA_ERROR` and increments `formula_errors`.
- **The status gate.** `:1236-1241` returns `INSUFFICIENT_DATA` only when there are no trades, no usable curve **and**
  `coverage_gaps or formula_errors or fund_refusals or fund_unknown`. An all-skipped run satisfies none of these and
  is `BACKTEST_STATUS_OK`.
- **Consequences of the false OK.** The run is scored for the run-history row (`_score_from_result`, `:1297`),
  persisted (`_persist_backtest_run`, `:1300`; `_persist_backtest_detail`, `:1314`), and the headline recompute runs
  (`_recompute_headline`, `:1322`).
- **How a custom formula reaches the skip.** `StrategyEvaluator._execute_formula`
  (`app/services/evaluator.py:254-266`) maps only `NOT_FOUND` to `FormulaExecutionError` (`:260-263`) and re-raises
  every other `AioRpcError` code. Indicators `ExecuteFormula` raises PERMISSION_DENIED to an admin-scoped non-author
  (`services/xstockstrat-indicators/app/handlers/servicer.py:243-248`, via `_can_read_formula` `:141-148`). A
  `GetBars` or `ComputeIndicator` RpcError reaches the same branch.

**Expected.** A requested symbol is never dropped silently. Every symbol that fails with an RPC error or an
unexpected exception gets a diagnostics row with a typed reason and a warning naming the symbol and the error status.
These failures count toward the status gate, so a run in which no symbol was evaluated is not `BACKTEST_STATUS_OK`:
it is not scored, not persisted as an OK detail, and does not drive the headline recompute as a success. A partial
run (some symbols evaluated) stays OK, with the failed symbols reported.

**Who is affected.** Anyone running a backtest (agent `run_backtest`, the strat-lab `backtest` skill, the UI backtest
view): a broken strategy reads as "no signal". Two `live_enabled` staging strategies (`squeeze_breakout_trend`,
`dip_buyer_vol_stop`) reference the unexecutable formulas.

## Reproduction Steps

1. On staging, call `run_backtest(squeeze_breakout_trend, ["AAPL"], start="2026-01-01", end="2026-09-30")`.
2. Observe `BACKTEST_STATUS_OK` with `diagnostics: []` and no warnings.
3. Unit level: stub indicators `ExecuteFormula` to raise `AioRpcError(PERMISSION_DENIED)` for the strategy's custom
   formula component; `RunBacktest` returns OK with no diagnostics row.

## Root Cause Hypothesis

Two layers (report § Root cause hypothesis):

- **(a) Contract defect, code-proven — this feature.** The catch-all branches drop the symbol without a diagnostics
  row, and the status gate cannot see them.
- **(b) Trigger, confirmed — not this feature.** Six staging formulas carry the legacy username `author = "davcs86"`
  instead of the owner's user id, so their owner cannot execute them and indicators returns PERMISSION_DENIED to the
  admin-scoped caller. That is a data defect (no indicators migration rewrote `author`). (a) is what hid (b).

## Affected Services

- xstockstrat-analysis (fix site)
- xstockstrat-indicators (read-only: the PERMISSION_DENIED / NOT_FOUND contract the mapping relies on)
- xstockstrat-agent (docs only: the `run_backtest` tool description and the strat-lab `backtest` skill, if the surfaced reason or warnings change — `docs/patterns/strat-lab-plugin.md`)

## Functional Requirements

- **FR-1** — When evaluating a requested symbol fails with a `grpc.RpcError` (for example a marketdata `GetBars` /
  indicators `ComputeIndicator` / `ExecuteFormula` call that returns a gRPC status such as UNAVAILABLE),
  `RunBacktest` appends a `SymbolDiagnostics` row for that symbol with a typed `no_trade_reason` other than
  `NO_TRADE_REASON_UNSPECIFIED`. An owner-unreadable formula refusal is handled by FR-8 instead.
- **FR-2** — When evaluating a requested symbol raises an unexpected exception (any other `Exception`), `RunBacktest`
  appends a `SymbolDiagnostics` row for that symbol with a typed `no_trade_reason` other than
  `NO_TRADE_REASON_UNSPECIFIED`.
- **FR-3** — Each FR-1 / FR-2 failure adds a result warning that names the symbol and, for an RPC error, the gRPC
  status code name (for example `PERMISSION_DENIED`, `UNAVAILABLE`).
- **FR-4** — FR-1 / FR-2 failures count toward the `INSUFFICIENT_DATA` status gate, alongside `coverage_gaps`,
  `formula_errors` and feature 215's `fund_refusals` / `fund_unknown`. A run with no trades and no usable curve in
  which every requested symbol failed this way returns `BACKTEST_STATUS_INSUFFICIENT_DATA`, not `BACKTEST_STATUS_OK`.
- **FR-5** — A run that FR-4 makes `INSUFFICIENT_DATA` is not scored as a success. Its run-history row records a
  null score (not 0) and an empty rating. No backtest detail row is written (`_persist_backtest_detail`). No
  per-symbol evidence cell is written. The success-driven headline recompute does not run for it (feature 215's
  refused-only recompute rule is unchanged). The null score is already current behavior for `INSUFFICIENT_DATA`
  runs (`score = None` unless status is OK, `servicer.py:1290-1299`), so FR-5 is a regression guard, not a change.
  `services/xstockstrat-analysis/CLAUDE.md` (Backtest Auto-Scoring & Run History) still says "0 score"; the fix PR
  corrects that drift (root Teardown rule).
- **FR-6** — A partial run, where at least one symbol is evaluated and produces trades or a usable curve, stays
  `BACKTEST_STATUS_OK`. It still carries the FR-1 / FR-2 diagnostics row and the FR-3 warning for each failed symbol.
- **FR-7** — The new handling must not absorb exceptions that other features re-raise on purpose. Feature 272's
  `_BarFetchError` keeps propagating (it maps to `FAILED_PRECONDITION` and is out of scope here), and
  `asyncio.CancelledError` / 272's run-timeout handling are not caught. Any warning or emit this change adds keeps
  the inbound `x-trace-id` metadata (operator directive 2026-10-21; no C-03 waiver). The trace-id clause has no
  user-visible outcome, so it is verified by a unit-test step in the implementation spec, not by a Gherkin scenario.
- **FR-8** — *(Added 2026-10-22, operator decision at the round-3 design gate, option (a); extends
  `@AC-30 @feature-224`.)* On the backtest path, an indicators `ExecuteFormula` refusal for a formula the strategy
  owner cannot run maps to `FormulaExecutionError`, whether indicators returns NOT_FOUND (owner caller) or
  PERMISSION_DENIED (admin caller). Both runs report `NO_TRADE_REASON_FORMULA_ERROR` and count toward the FR-4 gate.
  The FORMULA_ERROR row for such a refusal also adds an FR-3-style warning that names the symbol and the status
  code name only, never the indicators error detail, which names the foreign author. The live (non-backtest)
  evaluation path is unchanged.

**Run-history scope (FR-5).** An `INSUFFICIENT_DATA` run persists its run-history row (null score, empty rating) but
no detail row. Its per-symbol diagnostics and warnings are returned in the RPC result and held only in memory, so
they are not available after a service restart or a Past-Runs reload.

## Dependencies / Merge Order

- **Lands after feature 272** (`fix-analysis-backtest-bounds`, implementation-ready): same `RunBacktest` lines.
  On `main-dev`, `_BarFetchError` is defined and raised (`servicer.py:358`, `:1445`) but not yet mapped to
  `FAILED_PRECONDITION`. That mapping arrives with 272. FR-7's `_BarFetchError` clause and `@AC-6` can only pass
  once 272 is in, and this fix keeps 272's `except _BarFetchError: raise` ahead of the new catch-all handling.
- **Lands after feature 273** (`fix-agent-client-deadlines`) and **after feature 215**
  (`block-fundamentals-strategy-on-etf`). 215 changes the same status gate and edits `analysis.proto`, so this
  feature's gate change and any `NoTradeReason` value rebase onto 215's landed state.
- The merge-order rows are written at `/sdd-spec` (router-owned, operator confirmation).

## Consumer Surface(s)

- [x] **Agent MCP tool `run_backtest`** (`xstockstrat-agent`): the result now shows the failed symbol's diagnostics
  row and warning, and an all-failed run returns `BACKTEST_STATUS_INSUFFICIENT_DATA` instead of OK. The tool passes
  the result through, so no tool code change is expected. `docs/runbooks/mcp-tools.md` is updated if its
  `run_backtest` status / diagnostics description changes.
- [x] **strat-lab `backtest` skill** (`plugins/strat-lab/skills/backtest/SKILL.md`): it must stop reading "OK, zero
  trades, empty diagnostics" as "no signal". It documents the new reason and warnings and the all-failed
  `INSUFFICIENT_DATA` outcome, in the same PR (`docs/patterns/strat-lab-plugin.md`).
- [x] **UI backtest view** (`xstockstrat-ui`, `/insights` segment): the backtest result and run history show the
  diagnostics row and warning. An all-failed run shows the existing `INSUFFICIENT_DATA` state with no score. No new
  UI component is expected; design confirms the view already renders `diagnostics`, `warnings` and
  `INSUFFICIENT_DATA`, or adds a step if it does not.

## Fix Scope

- [x] Proto: the typed reason is a design-phase decision (closed here as a bounded choice). Either the design reuses
  an existing `NoTradeReason` value (no proto change), or it adds one new value for an RPC/unexpected evaluation
  failure. A new value is an **additive, non-breaking** change ("Adding a new enum value",
  `docs/runbooks/proto-versioning.md`). It is made on `analysis/v1` with no v2. It must take number **6 or later**:
  5 is `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` from feature 215. It goes through the standard proto-contract PR
  gate (root `CLAUDE.md` § Proto Contract Governance: `buf lint` + `buf breaking` green, `./scripts/buf-gen.sh`
  stubs committed, `proto-freshness` green) and needs the analysis proto owner's review. It needs no
  breaking-change approval (2 owners + platform lead).
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Each scenario is tagged with the `@FR-n` it covers (FR-1..FR-8). Plus:
existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Fixing the trigger (b): rewriting legacy username `author` values in `indicators.formulas` (a separate data-defect
  report is needed; production exposure is unchecked)
- Client deadlines on backtest-path RPCs (feature 272 bounds the run wall-clock; feature 273 bounds agent calls)
- The truncated-bar-series failure surface (`_BarFetchError` → `FAILED_PRECONDITION`), owned by feature 272. Only a
  `GetBars` call that itself returns a gRPC error status (for example UNAVAILABLE) is in scope (AC-2, AC-5)
