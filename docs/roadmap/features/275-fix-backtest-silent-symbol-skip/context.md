# Context Log: fix-backtest-silent-symbol-skip

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-22 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-15-backtest-silent-symbol-skip-reports-ok-defect.md` (Issues
  disabled), filed during feature 215 Step 26 staging verification (`215-block-fundamentals-strategy-on-etf/context.md:648`,
  `implementation-spec.md:1666`); sidecar now `triaged` / `ref: feature:275-fix-backtest-silent-symbol-skip`.
- Severity: SEV-2. Impact type: silent-failure / misleading-result. Environment: dev (staging, image `a8a3cfd`).
  Config-only: no. Routed to SDD path (Track C) per T-4.
- Operator decisions (2026-10-22): same triage-to-spec workflow as the debt-radar batch (254-273); standing rule — x-trace-id must be propagated as much as possible, no C-03 waiver.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md.
- Affected services: xstockstrat-analysis (fix site); xstockstrat-indicators (read-only contract); agent / strat-lab
  plugin docs if the surfaced reason or warnings change.
- **Re-verification on `main-dev` `6923e95a` (86 commits after `a8a3cfd`): reproduces by reading.** Line drift:
  - Silent skip: `app/handlers/servicer.py:1127-1129` (`except grpc.RpcError`) and `:1130-1132` (`except Exception`),
    each `log.warning(... — skipping)` + `continue` — **no drift**. `except FormulaExecutionError` `:1112-1126` — no drift.
  - Status gate: `:1236-1241` (report `:1235-1242`, same code).
  - False-OK consequences: score `:1293-1299`, `_persist_backtest_run` `:1300`, `_persist_backtest_detail` `:1314`,
    `_recompute_headline` `:1322` (report `~1293-1328`). Evidence cells are written only for OK runs (`:1279-1280`),
    so a false OK also writes empty-evidence cells.
  - `evaluator.py` `_execute_formula` `:254-266`, NOT_FOUND-only mapping `:260-263` (report `:257-261`, ±2).
  - indicators `ExecuteFormula` admin PERMISSION_DENIED `servicer.py:243-248` (report `:240-246`); `_can_read_formula`
    `:141-148` (report `:136-143`).
  - Tests: `TestFormulaErrorSurfacing` still `tests/test_analysis_servicer.py:1614`; `tests/test_unreadable_formula.py`
    still covers NOT_FOUND only. No test covers a non-NOT_FOUND RpcError or a generic exception in the symbol loop.
- Root cause hypothesis: (a) contract defect, code-proven — the catch-alls drop the symbol with no diagnostics row,
  warning or gate counter, so an all-skipped run passes the OK branch of the gate; (b) trigger, confirmed from staging
  logs — six formulas with legacy username `author = "davcs86"` make indicators return PERMISSION_DENIED to the
  admin-scoped owner. (b) is a data defect, out of scope here; it has **no** report or feature yet (only mentioned in
  `docs/reports/2026-07-20-custom-indicators-strategies.md`) — recommend `/sdd-qa defect` for it, and checking prod authors.
- Design forks for /sdd-design:
  1. Reason channel: reuse `NO_TRADE_REASON_FORMULA_ERROR` (wrong for a `GetBars` failure) vs a new `NoTradeReason`
     value (proto change, field `analysis.proto:197-202` enum) vs the existing `fund_unknown`-style warning-only path.
  2. Whether a non-NOT_FOUND `ExecuteFormula` error should become `FormulaExecutionError` in `_execute_formula` (one
     site) or stay an RpcError mapped in the loop (covers `GetBars`/`ComputeIndicator` too).
  3. The warning text must carry the gRPC status code but not leak foreign-formula detail beyond what indicators
     returned; the log lines at `:1128`/`:1131` carry no `x-trace-id` today — per the standing operator rule, the
     new log/warning path should include the inbound trace id (`_PROPAGATED_HEADERS`, `servicer.py:350`).
- Recommended design depth: full → `/sdd-design fix-backtest-silent-symbol-skip` (rationale: SEV-2 and the report
  raises a possible `NoTradeReason` proto addition — the C-0 full trigger; single fix-site service). If the design
  settles on an existing reason plus a warning, the operator may downgrade to
  `/sdd-design fix-backtest-silent-symbol-skip quick`.
- **Consumer-surface rule:** any change to `run_backtest` behaviour (status, diagnostics reason, warnings) must update
  the strat-lab plugin `backtest` skill (`plugins/strat-lab/skills/backtest/SKILL.md`) in the same PR
  (`docs/patterns/strat-lab-plugin.md`); also check `docs/runbooks/mcp-tools.md` and the agent `run_backtest` docstring.
- **OVERLAPS:**
  - `272-fix-analysis-backtest-bounds` (implementation-ready, on main-dev) — **hard overlap, same lines.** Its Step 3
    renames the `RunBacktest` body to `_run_backtest` behind an `@owner_scoped` wrapper and inserts
    `except _BarFetchError: raise` immediately before `except grpc.RpcError` at `:1127`; Steps 1–2 change
    `_fetch_bars_paged` (`:1394`); Steps 5–6 add an `asyncio.timeout` wall-clock bound and its AC-3b test guards
    against the `:1127-1132` handlers absorbing the cancellation. Land 275 **after** 272 and re-anchor; the new
    catch-all mapping must keep `_BarFetchError` re-raised (truncated series fails the run, R-1) and must not swallow
    the deadline/cancellation path. 272 Steps 7–8 also edit the strat-lab skill and `mcp-tools.md` error table — rebase
    conflict on the same docs. Add a merge-order row at /sdd-spec (after operator yes).
  - `273-fix-agent-client-deadlines` (implementation-ready) — touches agent `run_backtest` error text
    (`_grpc_error_message` pass-through, 45 s budget) and the strat-lab skill Phase 1/2 text. Docs-level rebase only;
    merge order is already 247 → 273 → 272, so 275 lands after both.
  - `215-block-fundamentals-strategy-on-etf` (in-progress) — recorded this defect; owns the adjacent
    `_FundamentalsUnavailable`/`_FundamentalsUnknown` branches (`:1086-1111`) and the `fund_refusals`/`fund_unknown`
    gate terms. Its `@AC-11` (refused-only run still recomputes) and `@AC-8` (outage is a rerun warning) must be
    preserved (C-16).
  - `262-fix-analysis-owner-scope`, `268-fix-indicators-formula-correctness` — same services, different code paths
    (entry backfill; indicators sandbox/`ExecuteFormula` config reads). No line overlap found.
- Development branch: feature/fix-backtest-silent-symbol-skip
