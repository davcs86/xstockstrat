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

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved (criteria: PASS WITH WARNINGS; overlap: WARN). Status: draft → spec-ready.
- Warnings:
  1. Dependency on unmerged 272 (C-11): `_BarFetchError` is only defined/raised on main-dev (`servicer.py:358`,
     `:1445`) and never mapped; the bare `except Exception` (`:1130-1132`) would swallow it today. **Resolved**: added
     product-spec § Dependencies / Merge Order and an AC-6 `Given feature 272 has landed` precondition.
  2. FR-7 trace-id clause had no observable scenario. **Resolved**: FR-7 now says it is verified by a unit-test step
     in the implementation spec.
  3. Doc drift: `services/xstockstrat-analysis/CLAUDE.md` says INSUFFICIENT runs record a "0 score"; the code records
     `score = None` (`servicer.py:1290-1299`). **Resolved in spec**: FR-5 now states the null score is current
     behavior (regression guard) and that the fix PR corrects the CLAUDE.md drift.
  4. AC-4 / AC-6 Then clauses lean on storage/handler internals. Open — acceptable as a regression guard; consider
     phrasing via `ListBacktests` / `GetBacktest` / run-history output at /sdd-spec.
  5. UI backtest view consumer surface is hedged. Open — must be resolved at design (C-14).
  6. A partial run whose single evaluated symbol has no trades and a flat curve becomes INSUFFICIENT_DATA under the
     `:1235-1241` gate; consistent with FR-4/FR-6 wording (FR-6 requires trades or a usable curve). Confirm at design.
- Overlap findings (WARN, no FAIL):
  - 272 `fix-analysis-backtest-bounds` (implementation-ready): same `RunBacktest` body (272 renames to `_run_backtest`
    behind `@owner_scoped`); 275 depends on 272's `_BarFetchError` handling. Expected impl-level merge conflict.
  - 215 `block-fundamentals-strategy-on-etf` (in-progress): same status-gate expression and refused-only recompute
    rule; both edit `analysis.proto` (215 adds `SymbolDiagnostics.fundamentals_gap = 6`, not a `NoTradeReason` value).
    No `NoTradeReason` number above 5 is claimed, so 6 is free today; second to merge regenerates stubs + re-runs
    `buf breaking`.
  - 273 `fix-agent-client-deadlines` (implementation-ready): shared agent `run_backtest` / `tools.py` surface only; 275
    makes no tools.py code change.
  - Low-risk: 270 (reads `_recompute_headline` region, analysis unchanged), 230 `fix-etf-flag-fill` (draft peer; joint
    review of the agent run_backtest summary text), 268 / 244 (shared run_backtest context), 262 (same file, other
    ranges).
  - Merge-order: no 275 row yet. Recommended rows (router-owned, operator confirmation at /sdd-spec): 275 blocked by
    272 (same RunBacktest lines, `_BarFetchError` surface) and by 215 (status gate + analysis.proto). 275 merges second.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Triaged 2026-10-22 from docs/reports/2026-10-15-backtest-silent-symbol-skip-reports-ok-defect.md; Track C; same triage-to-spec workflow as the debt-radar batch (254-273).
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
  - Scope boundary: the root trigger (formulas stored under the legacy username author) is tracked separately in docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md and is NOT fixed here; 275 fixes the silent skip and the false-OK status. 275 lands after 272 (same RunBacktest lines; keep 272's `_BarFetchError` re-raise) and after 273; any run_backtest behaviour change updates the strat-lab backtest skill in the same PR.
- Next: `/sdd-design fix-backtest-silent-symbol-skip`.

## Session 2026-10-22 — sdd-batch design gate (round 2)

Full debate halted at the approval gate after round 2 (gate policy: halt). design.md is not written and status.md is
unchanged (spec-ready), per the grilling protocol. The resume state is in the `sdd-batch-design-state` block below.

## Open Threads

- **Approach (round 2).** Fix the silent skip and the false OK in the `RunBacktest` symbol loop
  (`services/xstockstrat-analysis/app/handlers/servicer.py`). Lands after 272 and 273; every cited line must be
  re-anchored on the merged state of 272, 273 and 215 before /sdd-spec (272 renames the body to `_run_backtest`).
  - Proto + UI in one commit: add `NO_TRADE_REASON_EVALUATION_FAILED = 6` (next free value if 6 is taken), with a
    proto comment that pins the boundary against `FORMULA_ERROR` (4); regenerate stubs; add the
    `BacktestDiagnostics.tsx` `NO_TRADE_MESSAGE` key (copy does not start with "No trades —").
  - Loop: keep 272's `except _BarFetchError: raise`, then one inline `except Exception as e:` arm (no helper, no
    loop-level `TimeoutError` re-raise; 272's run deadline arrives as `CancelledError` and passes through). The arm
    derives `code` (gRPC status name, else exception type name), pops buffered `symbol_intents`, appends an
    EVALUATION_FAILED diagnostics row, records `(symbol, code)` in `eval_failures`, and logs a server WARN with the
    full error and the x-trace-id from `propagation_meta` (no new context minted).
  - Status gate: `eval_failures` joins only the INSUFFICIENT_DATA or-chain; the `:1320` recompute condition is
    unchanged, so @AC-11 @feature-215 holds. Warnings use a public `EVAL_FAILED_WARNING` constant
    (`backtest symbol {symbol} not evaluated: {code}`); `e.details()` never reaches the client.
  - Tests RED before GREEN (AC-1..AC-5, AC-6 after 272; per-symbol timeout row; CancelledError propagation; mixed
    refused + failed recompute; trace id on the WARN and on the completed event; PORTFOLIO intent pop). UI mock run,
    fixture + INVENTORY row, and a Playwright spec cloned from `backtest-coverage.spec.ts:97`. Same-PR docs: strat-lab
    SKILL.md, output-handling.md, self-grill.md §6, verification.md, agent `run_backtest` docstring, mcp-tools.md, the
    analysis CLAUDE.md "null score" fix, plus the Teardown. No agent code change.
- **Strongest open objection (non-blocking).** The broad `except Exception` arm would swallow a future deliberate
  re-raise (for example from in-progress 215). /sdd-spec must carry a checklist step that re-greps every raise and
  custom exception class reachable from the loop on the merged tree; today only `_BarFetchError` and `CancelledError`
  must pass through (adversary-verified). Other non-blocking items /sdd-spec must carry: the C-16 read of
  `services/xstockstrat-ui/acceptance/backtest-next-bar-fill.feature`, C-10 UI reachability, the strat-lab
  self-grill/verification files, agent docstring attachment drift, the 6-vs-4 enum boundary, and docs guidance that a
  non-StatusCode code name means a platform defect, not a data gap.
- **Floor status.** No Floor breaches (no migration, config key or pool change). Adversary verdict SOUND; both round-1
  blocking objections are closed.
- **@AC changes not covered by an operator decision.** None that change behaviour. @AC-11 @feature-215 and
  @AC-30 @feature-224 are PRESERVE (pinned by tests, no sign-off needed). AC-1..AC-4 (CHANGE), AC-5 (EXTEND) and AC-6
  (PRESERVE) are covered by the 2026-10-22 triage decision and the "keep 272's re-raise" directive.
- **Next.** Approve the design at the gate, then the next /sdd-batch run resumes from the block below and writes
  design.md.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Fix the silent skip and the false OK status in the RunBacktest symbol loop in services/xstockstrat-analysis/app/handlers/servicer.py. Re-anchor every line cited below on the merged state of 272, 273 and 215 before /sdd-spec writes steps (272 renames the body to _run_backtest).\n\n(1) Proto and UI, one commit (fails.md:81-83):\n- Add NO_TRADE_REASON_EVALUATION_FAILED = 6 to analysis/v1 NoTradeReason in packages/proto/analysis/v1/analysis.proto:196-203. If 6 is taken by then, use the next free value.\n- Its proto comment pins the boundary with FORMULA_ERROR. Wording: \"symbol not evaluated: an upstream RPC error or unexpected exception during evaluation; a custom-formula execution or contract error is FORMULA_ERROR (4).\" This is a C-18 boundary that protects @AC-30 @feature-224.\n- Run ./scripts/buf-gen.sh and commit the stubs.\n- In the same commit, add the BacktestDiagnostics.tsx NO_TRADE_MESSAGE key (:41-52). Its copy must not start with \"No trades —\". It says the symbol was not evaluated and points to the run warnings.\n\n(2) Loop handler. Replace servicer.py:1127-1132 with:\n- `except _BarFetchError: raise`, keeping 272's re-raise.\n- Then ONE `except Exception as e:` arm. There is no loop-level `except TimeoutError`.\n  - 272's run deadline (asyncio.timeout around _run_backtest) reaches the loop as CancelledError, which is a BaseException and passes through.\n  - An inner per-symbol TimeoutError becomes a row.\n- The arm computes `code = e.code().name` when e is a grpc.RpcError with a callable code(), otherwise type(e).__name__.\n- Inline, with no helper, the arm then:\n  - calls symbol_intents.pop(symbol, None), because :1046 buffers intents before _compute_metrics at :1050 can raise;\n  - appends a SymbolDiagnostics row following the :1112-1126 template (bars=[], reason EVALUATION_FAILED, bars_total=0, warmup_bars=0);\n  - appends (symbol, code) to a new eval_failures list declared beside formula_errors (:905);\n  - logs a server WARN with symbol, request.strategy_id, code, the full e, and the x-trace-id from dict(propagation_meta) (:806-810). It adds exc_info=True when e is not an RpcError. No new context is minted.\n\n(3) Status gate:\n- Add eval_failures to the INSUFFICIENT_DATA or-chain at :1238 only.\n- The recompute condition at :1320 stays `status == OK or fund_refusals > 0`.\n- The null score and the skipped detail and evidence writes follow from status != OK (:1279-1299, :1313-1314).\n\n(4) Warnings:\n- After the fund_unknown block (:1263-1266), extend result.warnings with EVAL_FAILED_WARNING.format(symbol=s, code=c) for each failure.\n- EVAL_FAILED_WARNING = \"backtest symbol {symbol} not evaluated: {code}\" is a public module constant next to _PROPAGATED_HEADERS (:350). This replaces the earlier _EVAL_FAILED_WARNING name.\n- The client-facing text never includes e.details(), because indicators' PERMISSION_DENIED detail names the foreign author.\n\n(5) Analysis tests, RED before GREEN:\n- AC-1 to AC-5, and AC-6 once 272 has landed.\n- (a) A per-symbol TimeoutError becomes an EVALUATION_FAILED row.\n- (a') CancelledError propagates out of _run_backtest.\n- (b) A mixed fund-refused and eval-failed run still recomputes, pinning @AC-11 @feature-215.\n- (c) The WARN record carries x-trace-id. The analysis.backtest.completed AppendEvent receives metadata=propagation_meta on an all-failed run; this is already true at servicer.py:1344-1352, so the test only pins it.\n- (d) In PORTFOLIO mode, a raise from _compute_metrics after intents were buffered leaves the symbol out of _simulate_portfolio.\n- Reuse make_servicer/_owned_ctx, _diag/_bars/_squeeze, the AioRpcError stub, TestFormulaErrorSurfacing and the test_warmup.py:260 raises pattern. Tests reference EVAL_FAILED_WARNING, not a literal.\n\n(6) UI, with reachability (C-10, C-12, insights.md:165-175):\n- Add an e2e/mock-backend.ts INSUFFICIENT_DATA run with no coverage gap and one EVALUATION_FAILED row, following the :1064-1086 pattern. Its fixture lives in e2e/fixtures/ with an INVENTORY.md catalog row, following the :61-62 pattern.\n- Add a Playwright spec cloned from e2e/insights/backtest-coverage.spec.ts:97. It asserts the diagnostics card message and data-testid=\"backtest-warnings\" (page.tsx:509-516).\n- Read services/xstockstrat-ui/acceptance/backtest-next-bar-fill.feature and record its PRESERVE/EXTEND verdict in design.md (C-16).\n\n(7) Docs in the same PR (strat-lab same-PR rule, fails.md:307-309):\n- plugins/strat-lab/skills/backtest/SKILL.md:164-173 and reference/output-handling.md:21-26.\n- reference/self-grill.md:33-39: in §6, add reason 6 and the `backtest symbol <SYM> not evaluated: <CODE>` warning.\n- reference/verification.md:26-33: correct the \"0-trade equity … silent non-evaluation\" line.\n- The services/xstockstrat-agent/app/tools.py:739-778 run_backtest docstring. It must state that an all-failed run is INSUFFICIENT_DATA with non-empty diagnostics and no coverage gap, after checking backtest_view.summarize's attachment logic. The current :749-750 text says no diagnostics means no attachment.\n- docs/runbooks/mcp-tools.md:308-310.\n- services/xstockstrat-analysis/CLAUDE.md: change \"0 score\" to \"null score\".\n- The skill and docs text must say that a code name not in grpc.StatusCode (for example AttributeError) means a platform defect to report, not a data gap to backfill or retry.\n- There is no agent code change.\n- Run the Teardown (context-forge refresh, or a manual reconciliation recorded in the PR body, per fails.md:670).\n\n(8) design.md notes:\n- An INSUFFICIENT_DATA run persists no _persist_backtest_detail (:1313-1314). Per-symbol failure rows live only in the in-memory _backtests (:1267-1268) and are lost on restart or Past-Runs reload. This is the same as the 215 refusals and is required by FR-5. The product-spec's \"run history shows the diagnostics row\" claim must be scoped accordingly.\n\nLands after 272 and 273.",
    "open_objections": [
      {
        "text": "C-16: services/xstockstrat-ui/acceptance/backtest-next-bar-fill.feature (confirmed present) has not been read. The approach touches the UI surface, so its scenarios must be read and a PRESERVE/EXTEND verdict recorded in design.md before /sdd-spec. No break is expected, because the page.tsx:569-574 INSUFFICIENT_DATA render path is unchanged.",
        "blocking": false
      },
      {
        "text": "C-10 reachability: the round-2 proposal added a mock row and an INVENTORY entry but no spec reads them. This synthesis adds a Playwright spec cloned from backtest-coverage.spec.ts:97 that asserts the diagnostics message and data-testid=backtest-warnings. The fixture goes in e2e/fixtures/ per C-12. The next artifact must carry this.",
        "blocking": false
      },
      {
        "text": "Strat-lab same-PR completeness: self-grill.md:33-39 §6 and verification.md:26-33 read reason values. Both were checked on the tree and lack the new reason. They must be in the docs step, alongside SKILL.md and output-handling.md.",
        "blocking": false
      },
      {
        "text": "Agent docstring drift: tools.py:749-750 says a run with no diagnostics and no trades has no attachment. An all-failed run will now have non-empty diagnostics. /sdd-spec must check backtest_view.summarize's attachment behaviour and state it explicitly in the docstring.",
        "blocking": false
      },
      {
        "text": "C-18 enum boundary: the value-6 proto comment must distinguish it from FORMULA_ERROR (4), so formula errors are never routed to 6. Routing them to 6 would break @AC-30 @feature-224 and the skill's formula-error key.",
        "blocking": false
      },
      {
        "text": "PLAT-N1 / client interpretation: an all-symbol programming bug now surfaces as INSUFFICIENT_DATA. The skill and doc text must say that a non-StatusCode code name means a platform defect to report, not a data gap to retry. This is a docs-only change.",
        "blocking": false
      },
      {
        "text": "Strongest risk: a future deliberate re-raise inside the loop, possibly from 215, would be swallowed by the broad arm. /sdd-spec must make this a checklist step with a verification line: re-grep every raise and custom exception class reachable from the loop body on the merged tree. Today only _BarFetchError and CancelledError need to pass through (adversary-verified).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-11@feature-215",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-30@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Reuse NO_TRADE_REASON_FORMULA_ERROR = 4. Its meaning is wrong for GetBars/ComputeIndicator RPC failures and generic exceptions (analysis.proto:196-203), and it blurs the skill's formula-error signal.",
      "Two new enum values (RPC_FAILED, UNEXPECTED_ERROR). YAGNI: the warning code already tells them apart, and each value costs another exhaustive UI map key.",
      "Map errors inside _execute_formula (evaluator.py:254-266). That does not cover GetBars, ComputeIndicator or generic exceptions (FR-1/FR-2), and it risks @AC-30 @feature-224.",
      "Let unexpected exceptions propagate as INTERNAL. That contradicts FR-2/AC-3, and one bad symbol would kill a multi-symbol run.",
      "Fail the whole RPC (FAILED_PRECONDITION/INTERNAL) on an all-failed run. That contradicts FR-4/FR-6, loses the run-history row, and splits one condition across two channels.",
      "Loop-level `except TimeoutError: raise`. It is redundant for 272's deadline, which arrives as CancelledError, and harmful for per-symbol timeouts, which it would escalate to run-level UNKNOWN.",
      "Two arms (except grpc.RpcError plus except Exception), or a _record_eval_failure helper. That duplicates the row, counter and warning bodies (C-18 DRY); one arm with an isinstance check wins.",
      "Add eval_failures to the :1320 recompute condition. That would CHANGE @AC-11 @feature-215 and is unnecessary, because the status gate already handles the score and the writes.",
      "Put e.details() in the client warning. It leaks the foreign formula author from indicators' PERMISSION_DENIED detail (indicators servicer.py:243-250); the full detail goes to the server log only."
    ],
    "open_risks": [
      "Merge-order drift: 272, 273 and 215 rewrite the same RunBacktest lines. Every cited path:line (servicer.py:350, :806-810, :905, :1046-1051, :1112-1132, :1238, :1263-1266, :1320, :1344-1352) must be re-anchored, and enum value 6 re-checked for collision.",
      "If 272's deadline lands as a wait_for inside the loop instead of an asyncio.timeout wrapper outside _run_backtest, the no-TimeoutError-re-raise decision must be revisited.",
      "272 taxonomy: GetBars UNAVAILABLE must remain a grpc.RpcError (not wrapped in _BarFetchError) for AC-2/AC-5. Re-grep 272's landed _fetch_bars_paged.",
      "Broad except Exception arm: a future sentinel exception (for example from in-progress 215) would be silently converted into a row unless it is listed above the arm.",
      "An INSUFFICIENT_DATA run persists no detail, so the per-symbol failure rows are lost on restart or Past-Runs reload. This is pre-existing and FR-5-mandated, and must be documented so the product-spec's run-history claim is not overstated.",
      "A partial run whose only evaluated symbol is flat with zero trades becomes INSUFFICIENT_DATA (accepted under FR-6).",
      "A code defect hitting every symbol now presents as INSUFFICIENT_DATA. Clients may read it as a data gap unless the skill and docs explain how to interpret non-StatusCode code names.",
      "Proto plus UI coupling: the UI key must land in the same commit as the stubs. The proto change needs analysis proto-owner review and must pass buf lint, buf breaking and proto-freshness.",
      "exc_info=True emits one stack trace per failed symbol. This is bounded by the size of the universe and accepted.",
      "Out of scope: the root trigger (legacy username formula authors) stays tracked in docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md. Affected runs now surface as INSUFFICIENT_DATA with PERMISSION_DENIED warnings."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-10",
      "C-11",
      "C-12",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "PLAT-N1",
      "fails.md:118-133",
      "fails.md:81-83",
      "fails.md:307-309",
      "fails.md:670",
      "insights.md:165-175"
    ],
    "rationale": "Round 2 closes both round-1 blocking objections, and the code supports the fixes.\n\n1. Timeout handling: there is no loop-level TimeoutError re-raise. 272's deadline cancels the task, so the loop sees CancelledError, a BaseException that `except Exception` does not catch. A TimeoutError appears only at the async-with exit, and 272 re-raises when not cm.expired(). Per-symbol timeouts correctly become rows. Tests (a) and (a') pin this.\n2. Observability: the server log keeps the full error, with exc_info for non-RpcError exceptions. Only the client warning is redacted to the code name.\n\nBoth items move to rejected alternatives and adopted approach. They are no longer open.\n\nThe adversary returned SOUND, with no Floor breach (no migration, config key or pool change) and no @AC regression. Its remaining items are completeness work, all adopted into the approach:\n- UI reachability via a cloned Playwright spec plus a fixture catalog row;\n- the C-16 read of the UI durable suite;\n- the two missing strat-lab reference files, verified on the tree;\n- agent docstring attachment drift;\n- a proto comment that pins the 6-vs-4 boundary;\n- docs guidance that non-StatusCode codes mean a platform defect.\n\nAll of these stay recorded as non-blocking open objections, because the proposal had not yet concretely answered them; /sdd-spec must carry them.\n\nThe proposer's unverified assumption about trace-id on the completed AppendEvent is resolved: servicer.py:1344-1352 already passes metadata=propagation_meta, checked on the tree. The contingent C-03 fix is dropped and test (c) only pins the existing behaviour.\n\nThe warning constant is renamed EVAL_FAILED_WARNING (public) so tests and docs can name it.\n\nPer the 2026-10-21 operator directive, the trace id comes from the run-scoped propagation_meta and no context is minted.\n\nAC-1 to AC-4 change observable behaviour, and AC-5 extends it. All are sanctioned by the 2026-10-22 triage decision that 275 fixes the silent skip and the false-OK status. AC-6 (272's _BarFetchError pass-through) is preserved per the operator's \"keep 272's re-raise\" directive. @AC-11 @feature-215 and @AC-30 @feature-224 are preserved and pinned by tests.\n\nNothing blocks approval. The design is ready for /sdd-spec once the non-blocking items are folded in and every cited line is re-anchored on the merged state of 272, 273 and 215."
  },
  "floor_breaches": []
}
```
