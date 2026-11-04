# Context: fix-backtest-silent-symbol-skip  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: SEV-2 bug fix in `xstockstrat-analysis` `RunBacktest` (`app/handlers/servicer.py`). The symbol loop used to
drop a symbol that failed with a `grpc.RpcError` or any `Exception` with no diagnostics row, warning or gate counter, so
a run that evaluated nothing was `BACKTEST_STATUS_OK`, scored and persisted as a success. Shipped: one surfacing
`except Exception` arm (after 272's `except _BarFetchError: raise`) that appends an `NO_TRADE_REASON_EVALUATION_FAILED = 6`
row, pops the buffered PORTFOLIO intent, records `(symbol, code)` in `eval_failures` and logs a WARN with `x-trace-id`;
`eval_failures` joins only the INSUFFICIENT_DATA gate; client warning is `EVAL_FAILED_WARNING` (code name only). The
backtest-path evaluator also maps an `ExecuteFormula` NOT_FOUND *and* PERMISSION_DENIED refusal to
`FormulaExecutionError(.code)` so admin and owner runs both report FORMULA_ERROR (4). Docs for agent `run_backtest`,
`mcp-tools.md`, the strat-lab `backtest` skill and analysis `CLAUDE.md` changed in the same PR. Launched 2026-11-04 via
PR #1406 (`86132e77`); code landed in #1396 (`708a8fea`; source: `git log`).

**Why (irrecoverable rationale)**:
- Triggered by feature 215's Step 26 staging verification; the real cause was six formulas with legacy username
  `author = "davcs86"`, which made indicators return PERMISSION_DENIED to the admin-scoped caller (old
  context.md@1ed63958:30-34). The catch-all hid that trigger; 275 fixes the hiding, not the data. The trigger was
  split to `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`, now tracked by feature
  276 (`launched`).
- New enum value 6 instead of reusing 4: FORMULA_ERROR means "the formula or its contract failed"; a `GetBars` /
  `ComputeIndicator` RPC failure or a generic exception is not that, and reusing 4 would blur the strat-lab skill's
  formula-error signal and risk `@AC-30 @feature-224` (design.md@1ed63958:165-167). Two values (RPC_FAILED /
  UNEXPECTED_ERROR) lost as YAGNI: the warning's code name already distinguishes them and each value costs another
  exhaustive `NO_TRADE_MESSAGE` key (design.md@1ed63958:168-169).
- Gate placement: `eval_failures` goes into the `:1238` INSUFFICIENT_DATA or-chain only. A non-OK status already makes
  the score null and skips detail/evidence writes, and leaving the recompute condition (`status == OK or
  fund_refusals > 0`) alone keeps `@AC-11 @feature-215` unchanged (design.md@1ed63958:79-82, :185-186).
- Client text carries only the gRPC status code name, never `e.details()`: the indicators PERMISSION_DENIED detail
  names the foreign formula author (design.md@1ed63958:187-188). Full detail goes to the server log only.
- One inline arm, no helper, no second `grpc.RpcError` arm: a two-arm / helper design duplicates the row, counter and
  warning bodies (C-18); the cost is that the arm is broad, so a test pins that `_BarFetchError` still passes through
  (design.md@1ed63958:182-184).
- No loop-level `except TimeoutError: raise`: 272's run deadline is an `asyncio.timeout` around `_run_backtest` and
  reaches the loop as `CancelledError` (a `BaseException`, not caught by `except Exception`); a per-symbol
  `TimeoutError` should become a row, and a re-raise would escalate it to a run-level UNKNOWN
  (design.md@1ed63958:180-181; confirmed on the merged tree, old context.md@1ed63958:617-619).
- Trace id read via `dict(propagation_meta).get("x-trace-id", "")`; a subscript would raise
  `KeyError` inside the except arm and escape the loop, turning a diagnosable symbol failure into a whole-RPC error
  (design.md@1ed63958:189-190). Standing operator rule (2026-10-21): propagate `x-trace-id` everywhere, no C-03 waiver,
  no minted context (old context.md@1ed63958:103).

**Rejected alternatives**:
- Option (b) at the round-3 gate (mediator's recommendation): record the admin-PERMISSION_DENIED (EVALUATION_FAILED 6)
  vs owner-NOT_FOUND (FORMULA_ERROR 4) asymmetry and leave it — lost because the operator chose (a) so one fact gets
  one reason regardless of caller scope; (b) was cheaper and in scope but would have shipped two reasons for the same
  unrunnable formula (design.md@1ed63958:172-174; old context.md@1ed63958:308-316, :471-478).
- Map every error inside `_execute_formula` (`evaluator.py:254-266`) — lost because it does not cover `GetBars` /
  `ComputeIndicator` / generic exceptions (FR-1/FR-2) and would turn an indicators outage into a formula error
  (design.md@1ed63958:170-171). (Shipped is a hybrid: the evaluator maps only the owner-unreadable refusal; the loop arm
  covers everything else.)
- Reuse reason 4 for all; two enum values; warning-only path (fails FR-1/FR-2 which need a non-UNSPECIFIED reason,
  recon.md@1ed63958:241-242).
- Let unexpected exceptions propagate as INTERNAL, or fail the whole RPC on an all-failed run — lost because one bad
  symbol would kill a multi-symbol run, it loses the run-history row, and it adds a third outcome; the docs
  discriminator separates platform defects at lower cost (design.md@1ed63958:175-179).
- Add `eval_failures` to the `:1320` recompute condition — would CHANGE `@AC-11 @feature-215` and is redundant.
- Map PERMISSION_DENIED in the live-loop path too — outside 275's backtest scope and would CHANGE `@AC-5 @feature-224`;
  the mapping is gated on `_raise_unreadable`, which is set only at the backtest evaluator
  (HEAD `servicer.py:2116`; every other `StrategyEvaluator(` site uses the default `False`)
  (design.md@1ed63958:191-192; old context.md@1ed63958:551-553, :697).

**Scars & gotchas**:
- A production catch-all also swallowed test-fixture gaps: a bare-`MagicMock` `GetBars` stub is not awaitable, its
  `TypeError` was caught and the symbol skipped, so four tests asserting an OK run passed for the wrong reason (an OK
  run with no symbol evaluated, the very defect). They went red only when the catch-all became a surfacing arm:
  `test_owner_dimension.py::TestAC21SameStrategyIdTwoOwners::{test_alice_backtest_leaves_bob_score_runs_and_details_untouched,
  test_owner_reads_own_backtest, test_admin_foreign_get_backtest_is_denied}` and
  `test_analysis_servicer.py::TestRunBacktestPersistence::test_ok_run_appends_history_row`. Operator chose Option A:
  fixture wiring only (60 real flat bars >= `slow_period(50)+2`, tail-aligned `ComputeIndicator` points), no assertion
  changed (implementation-spec.md@1ed63958:851-861; old context.md@1ed63958:819-827). Ledger: fails.md (2026-11-02 entry).
- 272's `disarm()` (HEAD `servicer.py:1340`; :1307 on the Step-1 merged tree) forbids moving any awaited state-writing call above it, so the new
  `EVAL_FAILED_WARNING` block is a synchronous `result.warnings.extend` placed after the `fund_unknown` block and before
  `disarm()` (old context.md@1ed63958:628-629).
- Indicators contract: `ExecuteFormula` returns NOT_FOUND to a missing formula and to a non-admin non-author, but
  PERMISSION_DENIED `"admins cannot execute another user's formula"` to an admin non-author
  (`indicators/app/handlers/servicer.py:239-253`). The only other PERMISSION_DENIED reachable from `ExecuteFormula` is
  `_reader`'s `_CallerRejected` for `x-user-id: system` without the internal grant (`:126-129`). The evaluator mapping
  keys on status code alone, so *any* backtest-path PERMISSION_DENIED becomes FORMULA_ERROR — correct for today's
  contract, must be re-checked if indicators adds another PERMISSION_DENIED source (old context.md@1ed63958:721-727;
  design.md@1ed63958:210-212).
- `asyncio.timeout`'s `TimeoutError` *is* an `Exception` subclass, unlike `CancelledError`; the safety of the single broad
  arm depends on 272's deadline being a wrapper around `_run_backtest` (not an in-loop `wait_for`) — verified at
  HEAD `servicer.py:811` (recon.md@1ed63958:220-222; old context.md@1ed63958:617-619).
- The broad arm will silently convert any *future* deliberate re-raise (a new sentinel exception) into a row. Guard: only
  `_BarFetchError` and `CancelledError` must pass through today (exception inventory re-grepped on the merged tree;
  `_FundamentalsPageError` is raised only under `_load_fundamentals`'s own best-effort `except`, `_GradeInputsUnknown`
  only on the grade path outside the loop), plus a test pinning `_BarFetchError` -> FAILED_PRECONDITION with no run
  persisted (old context.md@1ed63958:708-720; implementation-spec.md@1ed63958:134-143, :559).
- An INSUFFICIENT_DATA run persists the run-history row (null score, empty rating) but **no detail row**, so the
  per-symbol failure rows live only in the in-memory `_backtests` and are lost on restart or a Past-Runs reload. Same as
  215's refusals; required by FR-5; documented in analysis `CLAUDE.md` and `mcp-tools.md` rather than "fixed"
  (design.md@1ed63958:89-91; product-spec.md@1ed63958:107-109).
- A partial run whose only evaluated symbol has zero trades and a flat curve becomes INSUFFICIENT_DATA under the gate;
  accepted under FR-6 (old context.md@1ed63958:85-86).
- Intent buffering: `symbol_intents[symbol]` is written before `_compute_metrics` can raise, so the arm must pop it or a
  failed symbol leaks into PORTFOLIO `_simulate_portfolio` (design.md@1ed63958:63-64, :268-272).
- Consumers were trained that INSUFFICIENT_DATA => `trigger_backfill` (`SKILL.md:99-100` pre-change). An all-failed run
  has `coverage_gaps: []` and must never be backfilled; discriminator now in SKILL.md, `reference/backfill.md`, agent
  docstring and `mcp-tools.md`: empty gaps + EVALUATION_FAILED/FORMULA_ERROR = never backfill; UNAVAILABLE /
  DEADLINE_EXCEEDED / RESOURCE_EXHAUSTED = rerun later; PERMISSION_DENIED / NOT_FOUND / a non-StatusCode name (e.g.
  `AttributeError`) = report (platform defect or ownership problem) (design.md@1ed63958:147-151).
- Pre-existing, left alone: `tsc --noEmit` errors in `e2e/insights/backfills.spec.ts:135-136`; ~8 other test files keep
  inline `AioRpcError` builders (only the new `aio_rpc_error` conftest builder is shared) (implementation-spec.md@1ed63958:845-846, :894-896).
- Teardown: context-forge `context-constitution` was unavailable, so the root Teardown ran by hand and found two
  grounded drifts in analysis `CLAUDE.md` (§ Unreadable formula named only NOT_FOUND; 215's "refused symbol makes the run
  INSUFFICIENT_DATA" omitted the gate's no-trades condition). The integration PR body was required to carry that record
  (fails.md:670); whether it did was not verified in this archive (implementation-spec.md@1ed63958:920-932).
- Contract-error FORMULA_ERROR rows carry no warning. This is the design's reading of operator option (a), and the
  operator never explicitly confirmed it at impl-review (design.md@1ed63958:206-209; old context.md@1ed63958:572-573,
  :576-606); shipped as that interpretation (`test_formula_contract_error_adds_no_eval_warning`,
  implementation-spec.md@1ed63958:565-567; HEAD tests/test_analysis_servicer.py:2042).
- Spec RED forecast said AC-4 would be red pre-Step-6; it was green: Step 4 already maps its PERMISSION_DENIED input to
  FORMULA_ERROR so `formula_errors` drives INSUFFICIENT_DATA. AC-4 stays as the persistence pin
  (implementation-spec.md@1ed63958:871-876).
- `TestFormulaErrorSurfacing._wire` passes its arg as an `AsyncMock` `side_effect`, which rejects a bare response
  object; the new `_svc` passes exceptions through unchanged and wraps a response as `lambda *a, **kw: outcome`, so
  `_wire` was reusable unchanged (implementation-spec.md@1ed63958:877-879).
- Sequential-mode TDD workaround: paired tests belong to a later step's Files (F-08), so red->green ran as an
  out-of-repo scratch probe (`-p tests.conftest`), or RED was captured by temporarily restoring the pre-step file from a
  commit (implementation-spec.md@1ed63958:832-835, :838-841, :867-870).
- `buf-gen.sh` failed at the `gen/ts` `tsc` compile with no `node_modules` (implementation-spec.md@1ed63958:823-825).
- Local `pnpm test:e2e` timed out in `warmup.setup.ts` SSR pre-warm on a cold dev server; had to run CI-style with
  `pnpm build` and `CI=1 E2E_PREBUILT=1` (implementation-spec.md@1ed63958:887-892).
- The spec's Verification omitted the strat-lab `validate.py` check that `docs/patterns/strat-lab-plugin.md` requires
  (implementation-spec.md@1ed63958:907-910).
- `exc_info=True` writes one stack trace per failed symbol; accepted as bounded by universe size
  (design.md@1ed63958:221-222).

**Permanent deviations**:
Execution deviations (design/spec said X -> executed Y -> because Z):
- design.md said Steps 2 (proto) and 3 (stubs + UI key) land in one commit -> executed as two commits (Step 2 `.proto`
  source only; Step 3 regenerated `gen/` + `NO_TRADE_MESSAGE[EVALUATION_FAILED]`) -> because sequential-mode executes
  one commit per step; `gen/` was untouched at the intermediate commit so `tsc` stayed green, only `proto-freshness`
  was stale until Step 3 (implementation-spec.md@1ed63958:813-817, :830-831; design.md@1ed63958:19). Commit layout,
  not behavior.
- Spec Step 6 Files listed `servicer.py` only -> executed also edited `tests/test_owner_dimension.py` and
  `tests/test_analysis_servicer.py` -> because four OK-run tests had relied on the catch-all (see Scars; operator
  Option A).
- Spec Step 10 Instruction 2 said to "extend" the FORMULA_ERROR description in `reference/output-handling.md` ->
  executed a *new* `NO_TRADE_REASON_FORMULA_ERROR` bullet -> because no description existed there
  (implementation-spec.md@1ed63958:911-913).
No shipped *runtime behavior* contradicts design.md. (The AC-4 RED-forecast miss is a spec test-forecast discrepancy;
see Scars.)

Design-phase pivots / spec-review corrections (not shipped-vs-design deviations):
- Round-3 synthesis (option (b)) had admin PERMISSION_DENIED -> EVALUATION_FAILED (6) with a `PERMISSION_DENIED` warning;
  the operator overrode to option (a) at the gate, so `@AC-1` expects FORMULA_ERROR, FR-8 and `@AC-7` were added, and the
  evaluator (not just the loop) maps PERMISSION_DENIED (old context.md@1ed63958:471-478, :496-499). This EXTENDs
  `@AC-30 @feature-224`.
- Operator also signed off the `@AC-5 @feature-150` CHANGE (popping a failed symbol's buffered intent so it leaves
  `_simulate_portfolio`/the portfolio curve) as an intentional correction (design.md@1ed63958:268-272).
- /sdd-review product-spec: dependency on unmerged 272 (`_BarFetchError` only defined on main-dev, never mapped),
  FR-7 trace-id clause unobservable (verified by unit test, not Gherkin), analysis `CLAUDE.md` "0 score" vs code
  `score = None` drift (old context.md@1ed63958:70-99).
- /sdd-spec corrections: design cited `_not_found` at `test_unreadable_formula.py:220-221` (real `:33-36`) and `_diag` at
  `test_backtest_fundamentals_guard.py:180` (recon said `:320`) (old context.md@1ed63958:557-558).
- /sdd-review impl-spec: `buf breaking` baseline must be `origin/main-dev` (the PR target), not the branch; Step 4
  PERMISSION_DENIED breadth wording ("indicators refused", not only "owner cannot run"); re-check `score` stays the 3rd
  positional of `_persist_backtest_run` (old context.md@1ed63958:580-590).
- Re-spec 2026-11-01: line anchors only (272/273 launched; 215 in-progress but its value 5 / `fund_refusals` /
  `fund_unknown` in tree); no scope change (old context.md@1ed63958:608-634).

**Cross-feature signal**:
- 272 `fix-analysis-backtest-bounds` (same `RunBacktest` lines): 275 depends on its `_BarFetchError` re-raise and its
  `asyncio.timeout` wrapper; promoted suite `fix-analysis-backtest-bounds.feature` @AC-6 overlaps 275 @AC-6
  (FAILED_PRECONDITION), kept as NEW because 275 adds "no diagnostics row written by the RPC/exception handling".
- 215 `block-fundamentals-strategy-on-etf` (same gate expression and `analysis.proto`): 215 owns value 5; preserved
  `@AC-8` (outage is a rerun warning, `_FundamentalsUnknown` caught above the new arm) and `@AC-11` (refused-only run
  still recomputes).
- 273 (agent `tools.py` / strat-lab docs), 276 `fix-legacy-formula-authors` (the root trigger; `launched`), 224
  (`@AC-5`/`@AC-30` unreadable-formula rules).
- Merge-order row is at `docs/roadmap/features/merge-order.md:95` (275 blocked by 272, 273, 215); on 2026-11-02 the
  operator overrode it ("Override and pre-approve") because 215 was merged to `main-dev` but not `launched`; the
  Resolved column was deliberately left unedited (old context.md@1ed63958:1034-1037).
- Same pattern as fails.md:118-133 ("a graceful skip must never be silent"): this feature is the second hit in analysis.

**Deferred follow-ons**:
- Root trigger (legacy-username formula authors) -> feature 276, launched; production author exposure was unchecked at
  triage (product-spec.md@1ed63958:159-160).
- Run-history persistence of per-symbol rows for INSUFFICIENT_DATA runs (no detail row) is not addressed; documented only.
- Not widened: eight other test files still carry inline `AioRpcError` builders (C-13 candidate, not done).
- The durable suites were not amended for the signed-off `@AC-5 @feature-150` CHANGE (failed-symbol intent excluded from
  `_simulate_portfolio`) or the `@AC-30 @feature-224` EXTEND (backtest-path PERMISSION_DENIED -> FORMULA_ERROR with a
  code warning). `services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature` and
  `private-by-default-templates.feature` still state the pre-275 rule (design.md@1ed63958:263-272; old
  context.md@1ed63958:1038-1041 promotion plan wrote only the new suite; HEAD suites grepped 2026-11-04).

**Ledger entries written**: insights.md (1), fails.md (0 new) — see the 2026-11-04 entries. Two fails.md entries for this
feature already exist and are not repeated: 2026-10-22 owner-scoped RPC status-code mapping (`fails.md:3081`) and
2026-11-02 catch-all hid incomplete test mocks (`fails.md:3112`).

**Runtime-invariant recommendations (→ /context-constitution)**:
- analysis: `RunBacktest` symbol loop — handler order is load-bearing (`_InsufficientData`, `_FundamentalsUnavailable`,
  `_FundamentalsUnknown`, `FormulaExecutionError`, `_BarFetchError: raise`, then the single `except Exception`); only
  `_BarFetchError` and `CancelledError` may pass through; gate term `eval_failures` belongs to the INSUFFICIENT_DATA
  or-chain only, never the recompute condition.
- analysis/indicators: `NoTradeReason` 4 vs 6 boundary — 4 = evaluator-converted `FormulaExecutionError` (owner-unreadable
  NOT_FOUND/PERMISSION_DENIED, contract errors); 6 = any other upstream RPC status or unexpected exception.
- client-visible backtest warnings never include `e.details()` from indicators (foreign author leak).

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1ed63958.
