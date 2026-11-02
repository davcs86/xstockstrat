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

## Session 2026-10-22 — sdd-batch design gate (round 3)

Full debate halted at the approval gate after round 3 (gate policy: halt). design.md is not written and status.md is
unchanged (spec-ready), per the grilling protocol. The resume state is in the `sdd-batch-design-state` block below.

## Open Threads

- **Approach (round 3).** Same core as round 2: fix the silent skip and the false OK in the `RunBacktest` symbol loop
  (`services/xstockstrat-analysis/app/handlers/servicer.py`), landing after 272 and 273, with every cited line
  re-anchored on the merged state of 272, 273 and 215 before /sdd-spec (272 renames the body to `_run_backtest`).
  - Proto + UI in one commit: `NO_TRADE_REASON_EVALUATION_FAILED = 6` (next free value if taken). The proto comment
    now draws the 6-vs-4 line by mechanism: 6 = upstream RPC error (including an indicators PERMISSION_DENIED on an
    admin-run foreign formula) or unexpected exception; 4 = errors the evaluator converts to `FormulaExecutionError`
    (`evaluator.py:260-263`, owner-unreadable NOT_FOUND) and formula contract errors. Stubs + `NO_TRADE_MESSAGE` key.
  - Loop: keep 272's `except _BarFetchError: raise`, then one inline `except Exception as e:` arm (code name, pop the
    buffered intent, EVALUATION_FAILED row, `eval_failures`, server WARN with the trace id read via
    `dict(propagation_meta).get("x-trace-id", "")` so a missing trace id cannot raise inside the arm; `exc_info=True`
    for non-RpcError). No new context minted.
  - Gate: `eval_failures` joins only the `:1238` INSUFFICIENT_DATA chain; `:1320` unchanged. Warnings via the
    `EVAL_FAILED_WARNING` constant (kept only because tests import it); `e.details()` never reaches the client.
  - Tests RED before GREEN: AC-1..AC-5 (AC-6 after 272), plus (a) per-symbol timeout row, (a') CancelledError
    propagation, (b) mixed refused + failed recompute, (c) trace id on WARN incl. a no-trace-id variant and the
    completed event, (d) PORTFOLIO intent pop, (e) `_BarFetchError` passes the broad arm, (f) admin PERMISSION_DENIED
    -> EVALUATION_FAILED vs non-admin NOT_FOUND -> FORMULA_ERROR.
  - UI: mock-backend run + fixture + INVENTORY row + a Playwright spec asserting the new message renders
    (`page.tsx:569-574`) and the warning shows in `backtest-warnings`. C-16 verdict PRESERVE for @AC-11 @feature-151.
  - Same-PR docs: strat-lab SKILL.md, output-handling.md, self-grill.md §6, verification.md, and now
    reference/backfill.md, carrying the three-way discriminator (empty coverage_gaps + EVALUATION_FAILED = never
    backfill; UNAVAILABLE/DEADLINE_EXCEEDED/RESOURCE_EXHAUSTED = rerun later; PERMISSION_DENIED/NOT_FOUND/exception
    class name = report it); agent `run_backtest` docstring (no agent code change); mcp-tools.md; analysis CLAUDE.md
    "null score"; Teardown.
  - design.md must record: the formula-refusal asymmetry with option (b) recommended; handler order preserving @AC-8
    and @AC-30; the gate touching only `:1238`; the intent pop as an intentional @AC-5 @feature-150 correction; that
    INSUFFICIENT_DATA runs persist no detail (rows lost on restart / Past-Runs reload); the exception inventory.
- **Strongest open objection (non-blocking).** The formula-refusal asymmetry (C-18 / P-03 / C-11, confirmed on the
  tree): indicators `servicer.py:243-253` returns NOT_FOUND to a non-admin and PERMISSION_DENIED to an admin for the
  same unrunnable formula, and the evaluator maps only NOT_FOUND, so a non-admin run reports FORMULA_ERROR (4) with no
  warning while an admin run reports EVALUATION_FAILED (6) with a PERMISSION_DENIED warning. Both end in
  INSUFFICIENT_DATA, so neither is a false OK. Recommended option (b): record and pin, do not unify. Option (a),
  mapping PERMISSION_DENIED in `_execute_formula`, would EXTEND @AC-30 @feature-224 without operator sanction. Stays
  open until design.md records the chosen option. Also carried, non-blocking: the backfill discriminator in
  SKILL.md/backfill.md; the @AC-5 @feature-150 CHANGE; the Playwright reachability line; and the risk that the broad
  arm swallows a future sentinel (grep-checklist step + test (e) are the guards).
- **Floor status.** No Floor breaches (no migration, config key or pool change). Adversary verdict SOUND.
- **@AC changes not covered by an operator decision.** @AC-5 @feature-150 is a CHANGE (popping the buffered intent
  removes a failed symbol from PORTFOLIO output) with no explicit operator sanction; it is recorded as an intentional
  correction and tested by (d), and needs operator confirmation if a reviewer reads it as beyond scope. @AC-11
  @feature-215, @AC-30 @feature-224, @AC-8 and @AC-11 @feature-151 are PRESERVE (pinned by tests or verified by the
  C-16 read). AC-1..AC-4 (CHANGE), AC-5 (EXTEND) and AC-6 (PRESERVE) are covered by the 2026-10-22 triage decision
  and the "keep 272's re-raise" directive.
- **Next.** Operator decides option (a) vs (b) for the refusal asymmetry and confirms the @AC-5 @feature-150
  correction at the gate; the next /sdd-batch run resumes from the block below and writes design.md.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Fix the silent skip and the false OK status in the RunBacktest symbol loop in services/xstockstrat-analysis/app/handlers/servicer.py. Before /sdd-spec writes steps, re-anchor every cited line on the merged state of 272, 273 and 215. 272 renames the body to _run_backtest.\n\n(1) Proto and UI, one commit (fails.md:81-83).\n- Add NO_TRADE_REASON_EVALUATION_FAILED = 6 to NoTradeReason in packages/proto/analysis/v1/analysis.proto:196-203. If 6 is taken by then, use the next free value.\n- The proto comment draws the line by mechanism, not by topic (adversary objection 1): \"symbol not evaluated: an upstream RPC error (including an indicators PERMISSION_DENIED on an admin-run foreign formula) or an unexpected exception during evaluation; FORMULA_ERROR (4) is reserved for errors the evaluator converts to FormulaExecutionError (evaluator.py:260-263, owner-unreadable NOT_FOUND) and formula contract errors.\"\n- Run ./scripts/buf-gen.sh and commit the stubs.\n- In the same commit, add the NO_TRADE_MESSAGE key in BacktestDiagnostics.tsx:41-52. The copy says the symbol was not evaluated and points to the run warnings. It must not start with \"No trades —\".\n\n(2) Loop handler. Replace servicer.py:1127-1132 with `except _BarFetchError: raise` (keeping 272's re-raise), then one `except Exception as e:` arm. There is no loop-level `except TimeoutError`. The arm, written inline:\n- sets `code = e.code().name` when e is a grpc.RpcError with a callable code(), otherwise `type(e).__name__`;\n- calls `symbol_intents.pop(symbol, None)`, because :1046 buffers the intent before _compute_metrics runs at :1050;\n- appends a SymbolDiagnostics row following the :1112-1126 template (bars=[], reason EVALUATION_FAILED, bars_total=0, warmup_bars=0);\n- appends (symbol, code) to an eval_failures list declared beside formula_errors at :905;\n- logs a server WARN with symbol, request.strategy_id, code, the full e, and `dict(propagation_meta).get(\"x-trace-id\", \"\")`. Use .get, never subscripting (adversary objection 4): a KeyError inside the except arm would escape the loop. Add exc_info=True when e is not an RpcError. No new context is minted (operator C-03 directive).\n\n(3) Status gate.\n- Add eval_failures to the INSUFFICIENT_DATA or-chain at :1238 only.\n- Leave the :1320 recompute condition as `status == OK or fund_refusals > 0`.\n- Because status is no longer OK, the score is null and the detail and evidence writes are skipped (:1279-1299, :1313-1314).\n\n(4) Warnings.\n- After the fund_unknown block (:1263-1266), add `EVAL_FAILED_WARNING.format(symbol=s, code=c)` to result.warnings for each failure.\n- EVAL_FAILED_WARNING = \"backtest symbol {symbol} not evaluated: {code}\" is a module constant next to _PROPAGATED_HEADERS (:350). It stays a constant only because the tests import it (adversary objection 3 is satisfied by step 5). If /sdd-spec drops the test import, inline it as an f-string to match the fund_unknown sibling.\n- The client text never includes e.details(), because the indicators PERMISSION_DENIED detail would leak the foreign author.\n\n(5) Analysis tests, RED before GREEN.\n- AC-1 to AC-5, and AC-6 once 272 has landed.\n- (a) A per-symbol TimeoutError becomes an EVALUATION_FAILED row.\n- (a') CancelledError propagates out of _run_backtest.\n- (b) A run with both fund-refused and eval-failed symbols still recomputes, pinning @AC-11 @feature-215.\n- (c) The WARN record carries the trace id. A variant with no x-trace-id in the inbound metadata must still produce the row and must not raise. The analysis.backtest.completed AppendEvent receives metadata=propagation_meta on an all-failed run (already true at :1344-1352; the test only pins it).\n- (d) In PORTFOLIO mode, a raise from _compute_metrics after the intent was buffered leaves the failed symbol out of the _simulate_portfolio input and out of the portfolio curve.\n- (e) _BarFetchError still propagates past the broad arm (the AC-6 pin, plus the review-visibility compromise for the single-arm design).\n- (f) An admin caller whose ExecuteFormula gets PERMISSION_DENIED produces an EVALUATION_FAILED row with a `PERMISSION_DENIED` warning. A non-admin NOT_FOUND still produces FORMULA_ERROR, which pins @AC-30 @feature-224 and the recorded asymmetry.\n- Tests reference EVAL_FAILED_WARNING, never a literal. Reuse make_servicer/_owned_ctx, _diag/_bars/_squeeze, the AioRpcError stub, TestFormulaErrorSurfacing and the test_warmup.py:260 raises pattern.\n\n(6) UI, with reachability (C-10, C-12, C-14, insights.md:165-175).\n- Add an INSUFFICIENT_DATA run to e2e/mock-backend.ts with an empty coverage_gaps and one EVALUATION_FAILED row, following the :1064-1086 pattern.\n- Put its fixture in e2e/fixtures/ with an INVENTORY.md catalog row, following the :61-62 pattern.\n- Clone a Playwright spec from e2e/insights/backtest-coverage.spec.ts:97. It must assert that the new NO_TRADE_MESSAGE text renders through the page.tsx:569-574 path, and that data-testid=\"backtest-warnings\" (page.tsx:509-516) shows the warning. A passing tsc is not enough.\n- C-16 verdict for services/xstockstrat-ui/acceptance/backtest-next-bar-fill.feature (@AC-11 @feature-151): PRESERVE. The new rows have bars=[], so they add no per-bar rendering. Record this in design.md.\n\n(7) Docs, same PR (strat-lab same-PR rule, fails.md:307-309).\n- plugins/strat-lab/skills/backtest/SKILL.md:164-173 and reference/output-handling.md:21-26.\n- reference/self-grill.md:33-39 (§6): reason 6 and the `backtest symbol <SYM> not evaluated: <CODE>` warning.\n- reference/verification.md:26-33: correct the silent non-evaluation line.\n- reference/backfill.md (new, adversary objection 2). Today it only says \"a backtest never errors for missing history\", and SKILL.md:99-100 teaches \"INSUFFICIENT_DATA → trigger_backfill → re-run\". backfill.md must carry the discriminator.\n- The discriminator for SKILL.md and backfill.md:\n  - INSUFFICIENT_DATA with an empty coverage_gaps and EVALUATION_FAILED rows means never backfill.\n  - A warning code of UNAVAILABLE, DEADLINE_EXCEEDED or RESOURCE_EXHAUSTED means rerun later.\n  - A warning code of PERMISSION_DENIED or NOT_FOUND, or a Python exception class name (for example ValueError or AttributeError), means report it: a platform defect or ownership problem, not a data gap.\n- services/xstockstrat-agent/app/tools.py:739-778 docstring. :749-750 becomes: \"An INSUFFICIENT_DATA run gets no attachment. Its coverage gaps, warnings and per-symbol diagnostics are inline. An all-failed run has coverage_gaps: [] but non-empty diagnostics with NO_TRADE_REASON_EVALUATION_FAILED.\" This is grounded in backtest_view.py:73-74, :82-85 and :97-100. There is no agent code change.\n- docs/runbooks/mcp-tools.md:308-310.\n- services/xstockstrat-analysis/CLAUDE.md § Backtest Auto-Scoring: change \"0 score\" to \"null score\".\n- Record the formula-refusal asymmetry (see (8)) in SKILL.md and self-grill §6.\n- Run the Teardown (context-forge refresh, or a manual reconciliation recorded in the PR body, per fails.md:670).\n\n(8) design.md must record these decisions.\n- (i) The formula-refusal asymmetry. Option (b) is the mediator's recommendation:\n  - Indicators servicer.py:243-253 returns NOT_FOUND to a non-admin owner and PERMISSION_DENIED to an admin for a formula the owner cannot run. evaluator.py:260-263 converts only NOT_FOUND to FormulaExecutionError.\n  - So a non-admin owner's run reports FORMULA_ERROR (4) with no warning (pre-existing and unchanged). An admin's run of the same strategy reports EVALUATION_FAILED (6) with a `PERMISSION_DENIED` warning. Both runs are INSUFFICIENT_DATA, so neither is a false OK.\n  - Option (a), mapping PERMISSION_DENIED in _execute_formula, would EXTEND @AC-30 @feature-224 and add an FR-3 warning on the FORMULA_ERROR path. No operator decision sanctions that, and it reaches toward the out-of-scope root trigger. Pick (b) unless the operator chooses (a).\n- (ii) Handler order alone preserves @AC-8 and @AC-30. _FundamentalsUnknown, FormulaExecutionError, _InsufficientData and _FundamentalsUnavailable are all caught above the arm (:1065-1126).\n- (iii) The gate changes only :1238. :1320 is unchanged, so @AC-11 @feature-215 is preserved.\n- (iv) Popping the intent changes PORTFOLIO output for a symbol whose _compute_metrics raises. Record this as an intentional correction against @AC-5 @feature-150.\n- (v) INSUFFICIENT_DATA runs persist no detail (:1313-1314). The per-symbol rows live only in the in-memory _backtests (:1267-1268) and are lost on restart or a Past-Runs reload. Scope the product-spec's run-history claim to say so.\n- (vi) The inventory of exceptions reachable from the loop (adversary-verified). Only _BarFetchError and CancelledError must pass through today. /sdd-spec keeps a checklist step that re-greps the merged tree.\n\nLands after 272 and 273.",
    "open_objections": [
      {
        "text": "C-18 / P-03 / C-11 (adversary r3 objection 1, confirmed on the tree). One fact, 'the owner cannot run this formula', gets two different reasons depending on the caller's scope. Indicators servicer.py:243-253 returns NOT_FOUND to a non-admin and PERMISSION_DENIED to an admin. evaluator.py:260-263 maps only NOT_FOUND, so a non-admin run reports FORMULA_ERROR (4) with no warning, while the admin run (the staging trigger) reports EVALUATION_FAILED (6) with a PERMISSION_DENIED warning. The synthesis recommends option (b): record the asymmetry in design.md and the skill docs, word the proto comment by mechanism (FORMULA_ERROR = errors the evaluator converts to FormulaExecutionError), and pin both paths with test (f). Option (a), mapping PERMISSION_DENIED in _execute_formula, would EXTEND @AC-30 @feature-224 without operator sanction. This stays open until design.md records the chosen option.",
        "blocking": false
      },
      {
        "text": "PLAT-N1 / consumer contract (adversary r3 objection 2). SKILL.md:99-100 teaches that INSUFFICIENT_DATA means trigger_backfill and re-run, and reference/backfill.md currently says 'a backtest never errors for missing history'. The docs step must add the three-way discriminator to SKILL.md:164-173 and reference/backfill.md: empty coverage_gaps plus EVALUATION_FAILED means never backfill; a transient code (UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED) means rerun; PERMISSION_DENIED, NOT_FOUND or an exception class name means report it. backfill.md is now in the touchpoints, and /sdd-spec must carry it.",
        "blocking": false
      },
      {
        "text": "C-16 (adversary r3 objection 5). Popping the intent changes PORTFOLIO-mode output when a symbol's _compute_metrics raises after its intent was buffered at :1046. Record this against @AC-5 @feature-150 as an intentional CHANGE (a correction), not PRESERVE. Test (d) must assert that the portfolio curve excludes the failed symbol. No operator decision explicitly sanctions this change to @AC-5 @feature-150. If the reviewer reads it as beyond 'fix the silent skip', the operator must confirm.",
        "blocking": false
      },
      {
        "text": "C-14 / insights.md:165-175 (adversary r3 objection 7). The UI step must include a Playwright assertion that the new NO_TRADE_MESSAGE text actually renders for an INSUFFICIENT_DATA run with EVALUATION_FAILED rows (page.tsx:569-574 path). A passing tsc is not enough. This is adopted in approach (6), and /sdd-spec must write it as a verification line.",
        "blocking": false
      },
      {
        "text": "Strongest risk carried forward. A future deliberate re-raise inside the loop, for example a new sentinel from 215 or 272, would be swallowed by the broad `except Exception` arm. /sdd-spec must keep a checklist step that re-greps every raise and custom exception class reachable from the loop body on the merged tree. Test (e) pins _BarFetchError passing through, so the single-arm design stays visible in review.",
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
      },
      {
        "ac_id": "AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5@feature-150",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-11@feature-151",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Reuse NO_TRADE_REASON_FORMULA_ERROR = 4. The meaning is wrong for GetBars and ComputeIndicator RPC failures and for generic exceptions (analysis.proto:196-203), and it blurs the skill's formula-error signal.",
      "Two new enum values (RPC_FAILED and UNEXPECTED_ERROR). This is YAGNI: the warning code already tells them apart, and each value costs another exhaustive UI map key.",
      "Map every error inside _execute_formula (evaluator.py:254-266). This does not cover GetBars, ComputeIndicator or generic exceptions (FR-1/FR-2), and it puts @AC-30 @feature-224 at risk.",
      "Map only PERMISSION_DENIED to FormulaExecutionError in _execute_formula (adversary fork 1a). This would give one reason per root cause, but it EXTENDs @AC-30 @feature-224, needs a new FR-3 warning on the FORMULA_ERROR path, and has no operator sanction. Option (b), recording the asymmetry, is cheaper and in scope. The operator may still choose (a).",
      "Let unexpected exceptions propagate as INTERNAL. This contradicts FR-2/AC-3, and one bad symbol would kill a multi-symbol run.",
      "Fail the whole RPC (FAILED_PRECONDITION or INTERNAL) on an all-failed run, or only when every failure is a non-RpcError exception. This contradicts FR-2, FR-4 and FR-6, loses the run-history row, and adds a third outcome. The docs discriminator separates platform defects at lower cost.",
      "A loop-level `except TimeoutError: raise`. It is redundant for 272's deadline, which arrives as CancelledError, and harmful for per-symbol timeouts, which it would escalate to a run-level UNKNOWN.",
      "Two arms (`except grpc.RpcError` plus `except Exception`), or a _record_eval_failure helper. This duplicates the row, counter and warning bodies (C-18 DRY). Instead, one arm with an isinstance check, plus test (e) pinning _BarFetchError passing through, keeps the arm visible in review.",
      "Add eval_failures to the :1320 recompute condition. This would CHANGE @AC-11 @feature-215 and is unnecessary, because the status gate already handles the score and the writes.",
      "Put e.details() in the client warning. It leaks the foreign formula author from the indicators PERMISSION_DENIED detail; the full detail goes to the server log only.",
      "Read the trace id as `dict(propagation_meta)[\"x-trace-id\"]`. A KeyError inside the except arm, when the caller sent no trace id, would escape the loop and turn a diagnosable symbol failure into a whole-RPC error. Use .get(..., \"\")."
    ],
    "open_risks": [
      "Merge-order drift. 272, 273 and 215 rewrite the same RunBacktest lines. Every cited path:line (servicer.py:350, :806-810, :905, :928, :1046-1051, :1065-1132, :1238, :1263-1266, :1320, :1344-1352) must be re-anchored, and enum value 6 re-checked for a collision.",
      "If 272's deadline lands as a wait_for inside the loop rather than an asyncio.timeout wrapped around _run_backtest, the decision not to re-raise TimeoutError must be revisited.",
      "272 error taxonomy. A GetBars UNAVAILABLE must stay a raw grpc.RpcError, not wrapped in _BarFetchError, for AC-2 and AC-5. Re-grep 272's landed _fetch_bars_paged.",
      "The broad `except Exception` arm. A future sentinel exception would be silently turned into a row unless it is listed above the arm. The grep checklist step and test (e) are the guards.",
      "The formula-refusal asymmetry. Admin and non-admin runs of the same legacy-author strategy surface different reasons (EVALUATION_FAILED: PERMISSION_DENIED vs FORMULA_ERROR with no warning). This is documented, not unified, unless the operator picks option (a).",
      "Consumers trained on 'INSUFFICIENT_DATA means backfill' (SKILL.md:99-100) may backfill needlessly on an indicators outage until the discriminator ships in SKILL.md and backfill.md.",
      "An INSUFFICIENT_DATA run persists no detail, so the per-symbol failure rows are lost on restart or a Past-Runs reload. This is pre-existing and required by FR-5; it must be documented so the product-spec's run-history claim is not overstated.",
      "A partial run whose only evaluated symbol is flat with zero trades becomes INSUFFICIENT_DATA. Accepted under FR-6.",
      "Proto and UI coupling. The UI key must land in the same commit as the stubs. The change needs analysis proto-owner review and must pass buf lint, buf breaking and proto-freshness.",
      "exc_info=True writes one stack trace per failed symbol. Bounded by the size of the universe; accepted.",
      "Out of scope: the root trigger (formulas stored under the legacy username author) stays tracked in docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md. Admin-run affected backtests now surface as INSUFFICIENT_DATA with PERMISSION_DENIED warnings."
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
    "rationale": "Round 3 closes the seven round-2 objections with facts checked on the tree:\n- The C-16 read of the UI suite: PRESERVE for @AC-11 @feature-151.\n- The agent docstring, grounded in backtest_view.py:73-100.\n- An enumerated inventory of the exceptions reachable from the loop.\n- Cell hygiene: only the intent needs a pop.\n- The 6-vs-4 proto comment.\n- The client-interpretation guidance.\n- The Playwright reachability spec.\nThese move out of open objections.\n\nThe adversary returned SOUND with no Floor breach: no migration, config key or pool change, and no unsanctioned @AC regression on the core path.\n\nThe mediator checked its new objection 1 on the tree and it holds:\n- Indicators servicer.py:243-253 returns NOT_FOUND to a non-admin and PERMISSION_DENIED to an admin for the same unrunnable formula.\n- evaluator.py:260-263 converts only NOT_FOUND to FormulaExecutionError.\nThe synthesis recommends option (b), recording the asymmetry, over option (a), mapping PERMISSION_DENIED:\n- (a) EXTENDs @AC-30 @feature-224 and the FORMULA_ERROR warning surface, and no operator decision covers that.\n- (b) keeps 275 inside its scope: the silent skip and the false OK.\n- Under (b) both scopes already end in INSUFFICIENT_DATA, so neither path is a false OK.\nThe proto comment is reworded to draw the 6-vs-4 line by mechanism, which removes the contradiction the adversary found. The objection stays open, non-blocking, until design.md records the choice.\n\nObjection 2 was also confirmed: SKILL.md:99-100 teaches backfill on INSUFFICIENT_DATA, and backfill.md has no failure discriminator. backfill.md is added to the docs step with a three-way rule.\n\nObjections 3, 4 and 7 are folded concretely into the approach:\n- 3: the constant stays because tests import it.\n- 4: `.get(\"x-trace-id\", \"\")`, plus a no-trace-id test.\n- 7: the Playwright assertion on the new message.\n\nObjection 5 reclassifies @AC-5 @feature-150 as an intentional CHANGE, recorded and tested. No operator decision explicitly covers it, so it is flagged for confirmation if the reviewer reads it as beyond scope.\n\nThe adversary's two-arm compromise is adopted as test (e), which pins _BarFetchError passing through. It costs no handler duplication.\n\nPer the 2026-10-21 operator directive, the trace id comes from the run-scoped propagation_meta and no context is minted. AC-1 to AC-4 (CHANGE) and AC-5 (EXTEND) are sanctioned by the 2026-10-22 triage decision. AC-6 is preserved by the 'keep 272's re-raise' directive. @AC-8, @AC-11 @feature-215 and @AC-30 @feature-224 are preserved by handler order and gate placement, and pinned by tests.\n\nNothing blocks approval. The design is ready for /sdd-spec once design.md records the option (b) decision and the @AC-5 @feature-150 correction, and every cited line is re-anchored on the merged state of 272, 273 and 215."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md was written earlier. Services: analysis (the fix site), indicators (read-only), agent
  (docs only). Key reuse patterns:
  - the `except FormulaExecutionError` row template (`servicer.py:1112-1126`)
  - the `fund_unknown` warning list (`:928`, `:1263-1266`)
  - the run-scoped `propagation_meta` (`:806-810`)
- Phase 1 Grilling: 3 rounds (full). The operator approved at the round-3 gate. Adversary verdict SOUND; Floor clear.
- **Operator decisions at the r3 gate (2026-10-22, binding):**
  1. SIGN-OFF on the @AC-5 @feature-150 CHANGE. Popping the buffered PORTFOLIO intent of a symbol whose
     `_compute_metrics` raises, so that it is excluded from `_simulate_portfolio`, is an intentional correction.
  2. Formula-refusal asymmetry: OPTION (a), not (b).
     - On the backtest path (`_raise_unreadable`), indicators PERMISSION_DENIED maps to `FormulaExecutionError` the
       same way NOT_FOUND does. Admin and owner runs therefore both report `NO_TRADE_REASON_FORMULA_ERROR` (4).
     - The mapped refusal carries an FR-3-style warning with the status code name only, never `e.details()`.
     - This EXTENDS @AC-30 @feature-224.
- Chosen approach:
  - Add `NO_TRADE_REASON_EVALUATION_FAILED = 6`, with the stubs and the `NO_TRADE_MESSAGE` key in one commit.
  - Keep 272's `except _BarFetchError: raise`. Below it, add one inline `except Exception` arm that writes the row,
    pops the intent, appends to `eval_failures`, and logs a WARN with the trace id read via `.get`.
  - `eval_failures` joins only the `:1238` gate.
  - Both arms share `EVAL_FAILED_WARNING`, and `FormulaExecutionError` gains an optional `code`.
  - A Playwright spec proves the new reason renders in the UI.
  - The strat-lab, agent and mcp-tools docs change in the same PR and carry the backfill discriminator.
- Rejected:
  - option (b) (record the asymmetry and leave it)
  - reusing reason 4 for every failure
  - two enum values
  - two arms, or a helper
  - a loop-level `TimeoutError` re-raise
  - failing the whole RPC
  - changing the `:1320` recompute condition
  - `e.details()` in warnings
- Amended for option (a):
  - product-spec.md: the FR-1 example is narrowed, FR-8 is added, and FR-5 gains a run-history scope note.
  - acceptance.feature: AC-1 now expects FORMULA_ERROR and no indicators detail in the warnings. AC-7 is added for
    the owner NOT_FOUND path.
- Constitution rules touched: C-03, C-10, C-11, C-12, C-13, C-14, C-15, C-16, C-18, P-02, P-03, PLAT-N1. Floor
  breaches: none.
- Status: spec-ready → design-approved.

## Decisions

- Option (a) for the formula refusal. The mapping is gated on `_raise_unreadable`, so the live loop
  (@AC-5 @feature-224) is unchanged.
- Signed off: the @AC-5 @feature-150 CHANGE and the @AC-30 @feature-224 EXTEND. Preserved: @AC-11 @feature-215 and
  @AC-8.

## Open Threads

- [ ] Re-anchor every cited line (servicer.py, evaluator.py) on the merged 272/273/215 tree, and re-check enum value
  6. Target: the `/sdd-spec` re-anchor step.
- [ ] If 272's deadline lands as an in-loop `wait_for`, revisit the decision not to re-raise `TimeoutError`. Target:
  the `/sdd-spec` re-anchor step.
- [ ] Confirm that a `GetBars` UNAVAILABLE stays a raw `grpc.RpcError` after 272 (AC-2, AC-5). Target: the
  `/sdd-spec` re-anchor step.
- [ ] The broad `except Exception` arm may swallow a future sentinel exception. Guards: the grep-checklist step and
  test (e).
- [ ] Option (a) reading: the code-name warning applies only to RPC-mapped refusals (NOT_FOUND / PERMISSION_DENIED).
  Formula contract errors keep no warning. Confirm at `/sdd-review impl-spec`.
- [ ] The PERMISSION_DENIED mapping keys on the status code alone. The evaluator step re-checks indicators
  `servicer.py:243-253`.
- [ ] The backfill discriminator must ship in SKILL.md and reference/backfill.md. Target: the docs step.
- [ ] INSUFFICIENT_DATA runs persist no detail, so their rows are lost on restart or a Past-Runs reload. Target: the
  docs step.
- [ ] A partial run whose only evaluated symbol is flat with zero trades becomes INSUFFICIENT_DATA. Accepted under
  FR-6. Target: the AC-5 test.
- [ ] The proto change and the UI key land in one commit, with proto-owner review and green buf lint, buf breaking
  and proto-freshness. Target: the proto + UI step.
- [ ] `exc_info=True` logs one stack trace per failed symbol. Accepted; bounded by the universe size.
- [ ] Out of scope: legacy-username formula authors
  (`docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`).
- Next: `/sdd-spec fix-backtest-silent-symbol-skip`.

## Session 2026-10-22 — sdd-spec

- Wrote implementation-spec.md with 11 steps. Status: design-approved → implementation-ready.
- **Prerequisites have not landed.** On `origin/main-dev` `c25efbdc`, 272 and 273 are `implementation-ready` and 215
  is `in-progress`. Every `servicer.py` line in the spec is therefore pre-272. Step 1 is a hard gate:
  - It re-anchors every line on the merged tree.
  - It answers design Open Risks 1-3: where the deadline sits, the GetBars error taxonomy, and whether enum 6 is free.
  - It re-runs the exception inventory.
  - It stops `/sdd-execute` if any prerequisite is missing.
- Key codebase findings:
  - 272's planned deadline is `asyncio.timeout(limit or None)` around `_run_backtest` in the wrapper, not inside the
    loop (`272 implementation-spec.md:402-419`). Its T-inner-timeout test patches `_load_benchmark_bars`, which runs
    before the symbol loop. The single broad arm therefore does not conflict with 272's tests, and the decision not to
    re-raise `TimeoutError` stands, pending Step 1 confirmation on the landed code.
  - `raise_unreadable=True` is set only at `servicer.py:2036`, the backtest evaluator. Every other
    `StrategyEvaluator(` site uses the default (:3874, :4175, :4416, :4869, :5485, :5964, `app/main.py:156`). The
    option (a) mapping therefore cannot reach the live, readiness or opportunities paths.
  - `TestFormulaErrorSurfacing` (`tests/test_analysis_servicer.py:1614`) supplies the `_req`/`_formula_def`/`_wire`
    harness. The new tests reuse it through an instance, not a subclass, so its tests are not re-collected.
  - The `AioRpcError` builder gains a second consumer, so it moves to `tests/conftest.py` as `aio_rpc_error` (C-13).
  - Design cites were corrected to the real lines: `_not_found` is at `test_unreadable_formula.py:33-36` (design said
    :220-221), and `_diag` is at `test_backtest_fundamentals_guard.py:180` (recon said :320).
  - UI: the new mock sentinel `strat-eval-failed-001` follows `mock-backend.ts:1050-1069`. The warning string moves to
    the fixture `BACKTEST_EVAL_FAILED_WARNING` in `e2e/fixtures/backtests.ts`, because it has two consumers (C-12).
  - `plugins/strat-lab/skills/backtest/reference/backfill.md` has no INSUFFICIENT_DATA discriminator today. Step 10
    adds one under `## When to skip`.
- No migration (the next free numbers would be analysis 028 and indicators 008, both unused). No config key, no new
  env var or port, and no new outbound gRPC call: the evaluator keeps `metadata=self._meta`.

## Open Threads (sdd-spec)

- [ ] Merge-order rows: 275 is blocked by 272, 273 and 215. The rows are router-owned and need operator
  confirmation. This run was restricted to the feature directory, so they were **not** written to
  `docs/roadmap/features/merge-order.md`.
- [ ] Step 1 gate: re-anchor, Open Risks 1-3 and the exception inventory, on the merged 272/273/215 tree.
- [ ] The option (a) reading (the code-name warning applies only to RPC-mapped refusals) is still open for
  `/sdd-review impl-spec`. Steps 6 and 7 encode it (`test_formula_contract_error_adds_no_eval_warning`).
- Next: `/sdd-review fix-backtest-silent-symbol-skip impl-spec`.

## Session 2026-10-22 — sdd-review impl-spec

- Result: PASS WITH WARNINGS. 0 failures, 8 warnings, no Floor breaches. Overlap: WARN, with no field-number,
  migration or config-key collision. This review is advisory, and the lifecycle stays `implementation-ready`.
- Addressed in `implementation-spec.md`:
  - Step 2 `buf breaking`: the baseline is now `origin/main-dev`, the PR target, as in CI. The absolute path is now
    `$(git rev-parse --git-common-dir)`. The `subdir=` form is kept (PLAT-10).
  - Step 3 `packages/proto/gen/**`: `/sdd-execute` records the concrete generated files in the Deviation Log.
  - Step 8: the coverage threshold is stated as N/A. Playwright has no coverage gate, and the Vitest 40% gate covers
    `src/lib/**` only.
  - Step 4 PERMISSION_DENIED breadth: the Step 2 value-4 proto comment and the Step 9 doc wording now say
    "indicators refused", not only "owner cannot run". Step 1 gains item 5 to list every other `ExecuteFormula`
    PERMISSION_DENIED (today `_reader`'s system-identity grant check, indicators `servicer.py:126-129`).
  - Step 7 AC-4 `score` positional assertion: Step 1 gains item 6 to re-check the `_persist_backtest_run` signature
    (`servicer.py:2848-2858`) after 272 and 215 land.
- No change needed:
  - Step 1 pre-272 anchors: the reviewer confirmed them, and the hard gate already handles this. 215 being partly in
    the tree (value 5, `fund_refusals`, `fund_unknown`) is already a Step 1 check.
  - Step 6 inline arm size: consistent with C-18. Re-check readability if 272 or 215 add more arms.
- Still open:
  - [ ] Merge-order rows (275 after 272, 273 and 215) are not yet in `docs/roadmap/features/merge-order.md`. They are
    router-owned, need operator confirmation, and are outside this run's write scope. They must be written before
    `/sdd-execute` or before the PR opens: the `RunBacktest` lines, `analysis.proto`, `BacktestDiagnostics.tsx`, the
    e2e mocks, `tools.py`, `mcp-tools.md`, the strat-lab skill and the analysis `CLAUDE.md` all collide.
  - [ ] Overlap rebase hot spots for Step 1: `tests/conftest.py` and `tests/test_analysis_servicer.py` (215, 244, 262,
    227, 272); e2e `INVENTORY.md` and `mock-backend.ts` (215, 251, 256, 270); agent `tools.py` and `mcp-tools.md`
    (273, 215, 246, 242, 240).
  - [ ] Peer `fix-etf-flag-fill` (230) is `draft` with no implementation spec, so there is no collision today. Re-scan
    if it reaches `implementation-ready` first.
- Next: operator writes or confirms the merge-order rows, then `/sdd-execute fix-backtest-silent-symbol-skip` after
  272, 273 and 215 land.

## Session 2026-11-01 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup: `git merge --no-edit origin/main-dev` into the detached `origin/feature/fix-backtest-silent-symbol-skip`
  (`c5400f8a`) was already up to date, so there was no merge commit. `scripts/ledger-guard.py --own-slug
  fix-backtest-silent-symbol-skip --base origin/main-dev --fix` reported clean.
- Directive re-spec of steps 1, 5, 6, 7, 8 and 9 (`implementation-spec.md`). Only line anchors and evidence changed;
  there is no scope or design change. Every Files path exists, and every anchor symbol is still present.
  - Prerequisites: 272 and 273 are `launched`. 215 is `in-progress`, but `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5`,
    `fund_refusals` and `fund_unknown` are in the tree.
  - Re-anchor answers: (a) the deadline is `asyncio.timeout(limit or None)` around `_run_backtest` in the `RunBacktest`
    wrapper (`servicer.py:806-807`), and an inner `TimeoutError` is re-raised (:808-810). (b) `_fetch_bars_paged`
    (:1435-1495) does not wrap `GetBars` errors, so a raw `grpc.RpcError` reaches the loop. (c) `NoTradeReason` value 6
    is free; the last value is 5 at `analysis.proto:202`.
  - Exception inventory: the only new custom exception is `_FundamentalsPageError` (:372), and `_load_fundamentals`
    catches it internally (:1851). No new sentinel needs to sit above the Step 6 broad arm.
  - Merged `servicer.py` anchors: catch-alls :1165-1170, directly after 272's `except _BarFetchError: raise`
    (:1163-1164); gate :1273-1280 (or-chain :1276); `fund_unknown` warnings :1301-1304; `disarm()` :1307;
    `_persist_backtest_run` call :1341-1351 (`score` still 3rd positional; def :2895); recompute :1361;
    `raise_unreadable=True` :2082-2083. Other `StrategyEvaluator(` sites: :3921, :4222, :4463, :4914, :5530, :6010 and
    `app/main.py:157`.
  - New constraint noted in Step 6: 272's `disarm()` (:1307) forbids moving any awaited state-writing call above it.
    The new warnings block is a synchronous `extend`, so it goes after the `fund_unknown` block and before `disarm()`.
  - Test and UI anchors moved: `conftest.py` `ctx_with` :131 and `OWNER_HEADERS` :139; `TestFormulaErrorSurfacing`
    :1703; `_EOF_PAGE` :135; `_bar` :1485; `test_warmup.py` `_BarFetchError` raises :242/:253/:277;
    `mock-backend.ts` `strat-fundamentals-etf-001` :1123-1142; `INVENTORY.md` rows :36 and :66-67; agent `tools.py`
    :784-785 and :803-813; `mcp-tools.md` :324-325, plus the No-attachment paragraph at :395-398, which Step 9 now
    also corrects.

## Session 2026-11-01 — sdd-execute sequential (sdd-batch-execute)

- Mode: `/sdd-execute fix-backtest-silent-symbol-skip sequential`, run by `sdd-batch-execute` in its own worktree
  (single writer, P-01). The operator gave the up-front sequential confirmation (mode entry), so per-step
  confirmation is replaced by the plan's operator checkpoints.
- Lifecycle `implementation-ready` → `in-progress` (`status.md` and the `feature.md` history row).
- Branch base: `c5400f8a` already contains `origin/main-dev`, and the ledger guard is clean. The steps were re-spec'd
  in the session entry above.
- Tooling (operator-approved CI-equivalent fallbacks; each one used is logged in the `implementation-spec.md`
  Deviation Log): golangci-lint v2.14.0 at `/usr/local/bin/golangci-lint`; `./scripts/localenv-setup.sh` (Docker
  `Dockerfile.codegen`, buf 1.72.0) for buf lint/breaking and codegen; never start a database. Node is v22 while the
  root pins 24. This is noted and is not a blocker.
- Next: Step 1 (the re-anchor gate, whose answers are pre-recorded above and are re-confirmed by its Verification grep).
- Open threads carried forward: the merge-order rows (275 after 272, 273 and 215) are still not written to
  `docs/roadmap/features/merge-order.md`, because they are router-owned and need operator confirmation.

### Step 1 — re-anchor gate (2026-11-01, done)

- **Rebase gate.** `origin/main-dev` (`c2a263c0`) had moved one commit past the branch base (#1392, docs/tooling pins
  only: `tooling-setup.md`, `docker-build.md`, `codegen-toolchain-host-setup.md`; no overlap with this feature). A
  rebase would need a force-push, so `origin/main-dev` was **merged** in (merge commit `0f3e0c95`, the sequential-mode
  §5.5 branch-sync setup). `git merge-base --is-ancestor origin/main-dev HEAD` → `REBASED`.
- **Prerequisites.** 272 and 273 `status.md` = `launched`. 215 `status.md` = `in-progress`, but its gate code is in
  the tree (`NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5`, `fund_refusals`, `fund_unknown`), which is the Step 1
  criterion. Gate passes.
- **Re-anchor table** (`services/xstockstrat-analysis/app/handlers/servicer.py` unless noted; Steps 2–11 use the merged
  column):

  | symbol | pre-272 line | merged line |
  |---|---|---|
  | `_PROPAGATED_HEADERS` | 350 | 353 |
  | `class _BarFetchError` | 358 | 368 |
  | `class _FundamentalsPageError` | — | 372 |
  | `async def RunBacktest` (wrapper) | 785 | 794 |
  | `asyncio.timeout(limit or None) as cm` | — | 806 |
  | wrapper `except _BarFetchError as e` → FAILED_PRECONDITION | — | 815-819 |
  | `async def _run_backtest` | — | 821 |
  | `propagation_meta` | 806-810 | 842-846 |
  | `formula_errors: int = 0` | 905 | 941 |
  | `symbol_intents` | 910 | 946 |
  | `fund_refusals = 0` | 927 | 963 |
  | `fund_unknown: list[str] = []` | 928 | 964 |
  | `for symbol in symbols_to_run:` | 996 | 1032 |
  | `symbol_intents[symbol] = sym_intent` | 1046 | 1082 |
  | `_compute_metrics(daily_eq, trades, daily_eq[0])` | 1050 | 1086 |
  | `except _InsufficientData` | 1065 | 1101 |
  | `except _FundamentalsUnavailable` | 1086 | 1122 |
  | `except _FundamentalsUnknown` | 1104 | 1140 |
  | `except FormulaExecutionError as fe` | 1112-1126 | 1148-1162 |
  | loop `except _BarFetchError: raise` | — | 1163-1164 |
  | `except grpc.RpcError as e` (silent skip) | 1127-1129 | 1165-1167 |
  | `except Exception as e` (silent skip) | 1130-1132 | 1168-1170 |
  | status gate (or-chain at :1276) | 1235-1242 | 1273-1280 |
  | `fund_unknown` warnings | 1263-1266 | 1301-1304 |
  | `disarm()` | — | 1307 |
  | `self._backtests[backtest_id] = result` | 1267 | 1308 |
  | `_persist_backtest_run(` call | 1300-1303 | 1341-1351 |
  | `_persist_backtest_detail` (OK only) | 1313-1314 | 1354-1355 |
  | recompute `… or fund_refusals > 0` | 1320 | 1361 |
  | `analysis.backtest.completed` `AppendEvent` | 1344-1352 | 1385-1393 |
  | `_fetch_bars_paged` | 1394 | 1435-1495 |
  | `raise_unreadable=True` | 2036 | 2082-2083 |
  | `def _persist_backtest_run(self, result, symbols, score, …)` | 2848 | 2895 |
  | `evaluator.py` `class FormulaExecutionError` / `__init__` | 102 / 108 | 102 / 108 (unchanged) |
  | `evaluator.py` NOT_FOUND-only mapping | 260-263 | 260-263 (unchanged) |
  | `analysis.proto` last `NoTradeReason` | 201 (`= 4`) | 202 (`FUNDAMENTALS_UNAVAILABLE = 5`) |

- **Re-anchor answers.** (a) The 272 deadline is the wrapper `asyncio.timeout` around `_run_backtest` (:806-807), not
  an in-loop `wait_for`; design Open Risk 2 stands as decided. (b) `_fetch_bars_paged` awaits
  `self._marketdata.GetBars(...)` with no `try`, and its only raises are `_BarFetchError` (cursor stall / page cap), so
  a `GetBars` RPC error reaches the loop as a raw `grpc.RpcError`. AC-2 and AC-5 stand. (c) `NoTradeReason` value 6 is
  free; Steps 2, 3 and 8 use 6.
- **Exception inventory** (loop `try:` body → `_backtest_symbol_evaluated` :2042, `_backtest_symbol` :1537,
  `_resolve_prefixed_bars` :1497, `_fetch_bars_paged` :1435, `_load_fundamentals` :1804, `StrategyEvaluator`,
  `_compute_metrics` :7305):
  - Handled by name in the loop: `_InsufficientData`, `_FundamentalsUnavailable`, `_FundamentalsUnknown`,
    `FormulaExecutionError`.
  - **Must keep propagating:** `_BarFetchError` (272's re-raise at :1163-1164 stays above the new broad arm) and
    `asyncio.CancelledError` (a `BaseException`, so `except Exception` does not catch it). Nothing else.
  - `_FundamentalsPageError` is raised only by `_fetch_historical_fundamentals_paged` (:6537), whose only callers
    (:1844/:1848) sit inside `_load_fundamentals`, which catches it in its best-effort `except Exception` (:1851). It
    never reaches the loop. `_GradeInputsUnknown` is raised only on the grade path (:2787) and caught at :1370/:2604,
    outside the loop. No new sentinel needs to sit above the Step 6 broad arm.
  - Reaching the broad arm by design: raw `grpc.RpcError` (GetBars; ExecuteFormula non-NOT_FOUND until Step 4;
    ComputeIndicator) and evaluator `ValueError`s (definition validation, `evaluator.py:809-929`).
- **Indicators contract** (`services/xstockstrat-indicators/app/handlers/servicer.py`): `ExecuteFormula` (:234)
  returns NOT_FOUND for a missing formula (:239-241), PERMISSION_DENIED `"admins cannot execute another user's
  formula"` to an admin non-author (:245-249) and NOT_FOUND to any other non-author (:251-253). The only other
  PERMISSION_DENIED reachable from `ExecuteFormula` is `_reader`'s `_CallerRejected` for `x-user-id: system` without
  the internal grant (:126-129, via `_can_read_formula`). The :176-178 and :497-727 sites belong to the template,
  update, delete and saga RPCs and are not reachable from `ExecuteFormula`. Step 4's "any backtest-path
  PERMISSION_DENIED → `FormulaExecutionError`" covers both reachable sites.
- **`_persist_backtest_run` signature** unchanged: `score` is still the 3rd positional parameter (def :2895) and is
  passed positionally at :1341-1344. The Step 7 AC-4 assertion stands.
- TDD: N/A (verification/checklist step, no code). The Step 1 Verification grep output matched every merged anchor
  above.
- Next: Step 2 (proto `NO_TRADE_REASON_EVALUATION_FAILED = 6`, landing in one commit with Step 3).

### Step 2 — proto `NO_TRADE_REASON_EVALUATION_FAILED = 6` (2026-11-01, done)

- `packages/proto/analysis/v1/analysis.proto`: appended `NO_TRADE_REASON_EVALUATION_FAILED = 6` (:203) after value 5
  with the spec's comment, and widened the value-4 comment to the option (a) wording (indicators refusal: NOT_FOUND to
  the owner, PERMISSION_DENIED to an admin or for any other `ExecuteFormula` refusal). No other enum or message touched.
- The 6-vs-4 boundary: 4 = formula failure, out-of-contract series, or any `ExecuteFormula` NOT_FOUND/PERMISSION_DENIED
  refusal on the backtest path (Step 4 maps these); 6 = any other upstream RPC status or unexpected exception, explained
  in the run warnings.
- TDD: N/A (proto). Verification: `buf lint` → clean; `buf breaking` against `origin/main-dev` (`subdir=packages/proto`)
  → clean (additive enum value); the enum grep lists values 0–6. buf 1.72.0 ran inside the `Dockerfile.codegen` image
  (CI-equivalent fallback, Deviation Log).
- Committed alone (not with Step 3): the `.proto` source only, `gen/` untouched, so `tsc` is not broken; `proto-freshness`
  stays stale until Step 3 regenerates the stubs. Recorded in the Deviation Log.
- Pre-commit hook: the main worktree has no `node_modules` and `core.hooksPath` is unset, so husky does not run in this
  worktree; the commit was made without `--no-verify`.
- Next: Step 3 (`./scripts/buf-gen.sh` via the codegen image + `NO_TRADE_MESSAGE[EVALUATION_FAILED]`).

### Step 3 — proto-gen + UI `NO_TRADE_MESSAGE[EVALUATION_FAILED]` (2026-11-01, done)

- `./scripts/buf-gen.sh` ran in the `Dockerfile.codegen` image (CI-equivalent fallback, see the Deviation Log). It
  regenerated 8 `packages/proto/gen/` files, all `analysis/v1` (Go, Python, TS source, TS `dist`). A second run gave
  a byte-identical diff.
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx`: added
  `[NoTradeReason.EVALUATION_FAILED]` after `FUNDAMENTALS_UNAVAILABLE`, using the spec copy "Not evaluated — … stopped
  this symbol from being evaluated. …". It does not start with "No trades —". Step 8 asserts this substring.
- TDD: N/A (proto-gen). Compile-check RED/GREEN anyway:
  - RED: after regeneration and before the key, `tsc --noEmit` failed with `BacktestDiagnostics.tsx(41,7): TS2741
    Property '[NoTradeReason.EVALUATION_FAILED]' is missing`.
  - GREEN: that error is gone after the key was added.
  - Two `tsc --noEmit` errors remain in `e2e/insights/backfills.spec.ts:135-136`. That file is untouched and exists
    on `origin/main-dev`, and it is outside the `next build` type-check.
- Verification: `pnpm run lint` → 0 errors (existing warnings only, none in `BacktestDiagnostics.tsx`). `pnpm build` →
  success. The `EVALUATION_FAILED` grep hits `analysis.proto:203` and `BacktestDiagnostics.tsx:52`.
- Next: Step 4.

### Step 4 — evaluator refusal mapping (2026-11-01, done)

- `services/xstockstrat-analysis/app/services/evaluator.py`:
  - `FormulaExecutionError.__init__` gained `code: str = ""`, stored as `self.code` (gRPC status name). The docstring
    says it is set only for an owner-unreadable refusal. All 2-arg raise sites are unchanged, so contract errors keep
    `code == ""`.
  - `_execute_formula`: when `_raise_unreadable` is set and the code is NOT_FOUND or PERMISSION_DENIED, it raises
    `FormulaExecutionError(formula_id, "not readable by owner", e.code().name)`. `e.details()` is never used. The live
    path is unchanged: PERMISSION_DENIED and every other non-NOT_FOUND code re-raise, and NOT_FOUND skips with the
    one-time warning. `metadata=self._meta` is unchanged.
- TDD (scratch probe, see Deviation Log; Step 5 lands the durable tests): AC-1 red: `AioRpcError` PERMISSION_DENIED
  propagated, and AC-7 red: `AttributeError: 'FormulaExecutionError' object has no attribute 'code'` (3 failed, 3
  pins passed) → green: 6 passed.
- Verification: the grep hits `evaluator.py:109`, `:264`, `:266`, `:268`; `ruff check` → all passed; `ruff format
  --check` → 121 files already formatted. Also run: `tests/test_unreadable_formula.py` 7 passed; full suite 1498
  passed, coverage 90.24% (≥40).
- Spec citation drift: `servicer.py:2036` → `app/handlers/servicer.py:2083` (Deviation Log).
- Next: Step 5 (evaluator refusal-mapping tests + the shared `aio_rpc_error` conftest builder).

### Step 5 — evaluator refusal-mapping tests (2026-11-01, done)

- `services/xstockstrat-analysis/tests/conftest.py`: added `import grpc` and `aio_rpc_error(code, details="")`
  (C-13 shared builder; Step 7 is its second consumer).
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py`: `_not_found()` now delegates to `aio_rpc_error`;
  added `pytest` and `FormulaExecutionError` imports and six unit tests (AC-1 PERMISSION_DENIED → `.code` with no
  `"admins cannot"` leak, AC-7 NOT_FOUND → `.code`, contract error `.code == ""`, live-path PERMISSION_DENIED re-raise
  pin, live-path NOT_FOUND skip pin, backtest UNAVAILABLE re-raise = 6-vs-4 boundary). `test_ac5_*`/`test_ac30_*`
  unchanged.
- TDD: RED against the pre-Step-4 `evaluator.py` (temporarily restored from `c7c287a0`, see Deviation Log): 3 failed
  (the two mapping tests and `AttributeError: ... no attribute 'code'`), 10 passed. GREEN on the Step 4 evaluator: 13
  passed.
- Verification: full suite 1504 passed, coverage 90.25% (≥40); `ruff check` all passed; `ruff format --check` 121
  files formatted; the C-13 grep for `grpc.aio.AioRpcError(` in the test file has no hit.
- Next: Step 6.

### Step 6 — single surfacing arm, gate term and warnings (2026-11-01, done)

- `services/xstockstrat-analysis/app/handlers/servicer.py`:
  - Added `EVAL_FAILED_WARNING = "backtest symbol {symbol} not evaluated: {code}"` beside `_PROPAGATED_HEADERS`.
  - Added `eval_failures: list[tuple[str, str]] = []` beside `formula_errors`.
  - The `FormulaExecutionError` arm appends `(symbol, fe.code)` only when `fe.code` is set, so mapped refusals warn
    and contract errors stay silent.
  - The `grpc.RpcError` and `except Exception` arms became one `except Exception` arm after `except _BarFetchError:
    raise`. It derives the code name (the RpcError status, else the type name), pops `symbol_intents[symbol]`, and
    logs symbol, strategy, code, error and `x-trace-id` via `.get`, with `exc_info` for non-RPC errors. It also
    appends an `EVALUATION_FAILED` diagnostics row and records the failure in `eval_failures`.
  - Gate: `or eval_failures` was added to the INSUFFICIENT_DATA or-chain, and the comment now names "not evaluated".
    The recompute condition `status == OK or fund_refusals > 0` is unchanged.
  - The `EVAL_FAILED_WARNING` warnings sit after the `fund_unknown` block and before `disarm()`. They carry the code
    only, never `e.details()`.
- Operator Option A (blocker resolution): four tests had passed only because the catch-all swallowed a `TypeError`
  from an unawaitable `MagicMock` `GetBars`. Fixture wiring with real bars plus `ComputeIndicator` points was added in
  `tests/test_owner_dimension.py` (`_bars()`, `_wired()`) and in `tests/test_analysis_servicer.py`
  (`TestRunBacktestPersistence::test_ok_run_appends_history_row`). No assertion changed (Deviation Log).
- **fails.md candidate**: "a catch-all hid incomplete test mocks". A broad `except Exception: continue` in production
  code also swallows test-fixture gaps, such as a bare-`MagicMock` gRPC stub that is not awaitable. Tests then pass
  for the wrong reason: here, an OK run with no symbol evaluated, which is the very defect under fix. Narrowing or
  surfacing a catch-all must budget for the tests it was silently carrying. A test that asserts an OK run should also
  prove a symbol was evaluated.
- TDD: scratch probe (Deviation Log). RED: 3 failed. GREEN: all passed.
- Verification: the grep hits `servicer.py:354`, `:943`, `:1165`, `:1167`, `:1175`, `:1189`, `:1194`, `:1301` and
  `:1330`. By hand: the loop arms run `_InsufficientData`, `_FundamentalsUnavailable`, `_FundamentalsUnknown`,
  `FormulaExecutionError`, `_BarFetchError` (raise), then the single `except Exception`, with no `grpc.RpcError` arm.
  `:1390` is still `status == OK or fund_refusals > 0`. `ruff check` passed, and `ruff format --check` reported 121
  files formatted. The full suite passed 1504 tests, coverage 90.20% (≥40).
- Next: Step 7 (the durable RunBacktest evaluation-failure tests, AC-1…AC-7).

### Step 7 — RunBacktest evaluation-failure surfacing tests (2026-11-01, done)

- `services/xstockstrat-analysis/tests/test_analysis_servicer.py`: imports `EVAL_FAILED_WARNING`, `_BarFetchError`,
  `_FundamentalsUnavailable` and `aio_rpc_error`. New class `TestEvaluationFailureSurfacing` sits directly after
  `TestFormulaErrorSurfacing` and reuses its `_req`/`_formula_def`/`_wire` through a class-level instance (no
  subclass). 15 tests: AC-1, AC-7, AC-2, AC-3, AC-4, AC-5, (a) timeout, (a') CancelledError, (b) refused+failed
  recompute, (c) trace-id log + `analysis.backtest.completed` metadata and its no-trace variant, (d) portfolio
  `symbol_intents` exclusion, (e) `_BarFetchError` → FAILED_PRECONDITION abort with no run persisted, (f) a contract
  error adds no warning, (g) ExecuteFormula UNAVAILABLE → EVALUATION_FAILED.
- TDD: RED on the pre-Step-6 servicer (temporarily restored, Deviation Log): 11 failed, 7 passed. AC-4 was already
  green after Step 4, because PERMISSION_DENIED maps to FORMULA_ERROR, which gates. GREEN: 18 passed.
- Verification: the `-k` run passed 18; the full suite passed 1519, coverage 90.30% (≥40); `ruff check` all passed;
  `ruff format --check` 121 files formatted. The grep shows the `tests.conftest` import with `aio_rpc_error` and the
  `EVAL_FAILED_WARNING` uses. No new inline `AioRpcError` builder. `test_unreadable_formula.py`,
  `test_backtest_fundamentals_guard.py` and `test_warmup.py` are unchanged (68 passed).
- Next: Step 8 (`/insights` reachability of the new reason and warning).

### Step 8 — `/insights` reachability of the new reason and warning (2026-11-01, done)

- `e2e/fixtures/backtests.ts`: `BACKTEST_EVAL_FAILED_WARNING = 'backtest symbol AAPL not evaluated: UNAVAILABLE'`
  (mirrors analysis `EVAL_FAILED_WARNING`, C-12). `e2e/mock-backend.ts`: imports it and adds the
  `strat-eval-failed-001` `RunBacktest` sentinel before `strat-formula-error-001` (status 2, no coverage gap, one
  `AAPL` diagnostic `noTradeReason: 6`, `warnings: [BACKTEST_EVAL_FAILED_WARNING]`). `INVENTORY.md`: the fixture row
  beside the 217 seed-span warning and the sentinel row beside `strat-fundamentals-etf-001`.
- `e2e/insights/backtest-coverage.spec.ts`: imports the fixture from `../fixtures` and adds
  `evaluation-failed backtest renders the not-evaluated reason and the warning` (banner text
  `stopped this symbol from being evaluated`, the `backtest-warnings` card carries the fixture string,
  `insufficient-data` count 0).
- TDD: RED with the fixture and spec but no mock branch: the new test failed (no `no-trade-reason` element). GREEN:
  13 passed in the spec file (chromium).
- Verification: `pnpm run lint` passed (pre-existing warnings only); both greps hit; e2e ran in CI mode (Deviation
  Log, CI-equivalent fallback). `tsc --noEmit` shows only two pre-existing `backfills.spec.ts` errors.
- Next: Step 9 (agent `run_backtest` docstring and `docs/runbooks/mcp-tools.md`).

### Step 9 — agent `run_backtest` docstring and `docs/runbooks/mcp-tools.md` (2026-11-01, done)

- `services/xstockstrat-agent/app/tools.py` (`run_backtest` docstring only): the no-attachment sentence now says an
  INSUFFICIENT_DATA run's coverage_gaps, warnings and per-symbol diagnostics are inline, and that an all-failed run
  has `coverage_gaps: []` with EVALUATION_FAILED or FORMULA_ERROR rows. A new "Evaluation failures (feature 275)"
  paragraph after the feature-215 one gives the reason, the `backtest symbol <SYM> not evaluated: <CODE>` warning, the
  PERMISSION_DENIED/NOT_FOUND FORMULA_ERROR codes and the discriminator (never backfill with empty gaps; rerun on
  UNAVAILABLE/DEADLINE_EXCEEDED/RESOURCE_EXHAUSTED; report PERMISSION_DENIED/NOT_FOUND/exception names).
- `docs/runbooks/mcp-tools.md` `### run_backtest`: the same contract as a bullet after the pre-window `coverage_gaps`
  → `trigger_backfill` bullet (plus the @AC-5 partial-run sentence), and the **No-attachment case** paragraph corrected
  the same way, with the Open Risk 8 note (INSUFFICIENT_DATA persists no detail; rows lost on restart or Past-Runs
  reload). `list_templates`/`instantiate_template` mentions untouched; no `is_public`/`include_public` (@AC-32).
- TDD: N/A (docs). Baseline: the Verification grep had 0 hits in `tools.py` and none in the `run_backtest` section of
  `mcp-tools.md` on `d1e52e97`; after: `tools.py:786,816,817`, `mcp-tools.md:328,329,410`.
- Verification: agent suite 613 passed, coverage 84.17% (≥40); `ruff check` all passed; `ruff format --check` 63
  files formatted. `is_public` grep: no hits.
- Next: Step 10 (strat-lab `backtest` skill).

