# Design: fix-backtest-silent-symbol-skip

**Created**: 2026-10-22
**Rounds**: 3 (full; termination: approved. The operator approved at the gate after round 3, Floor clear, with two binding decisions: sign-off on the @AC-5 @feature-150 correction, and option (a) for the formula-refusal asymmetry)
**Approved by**: user @ 2026-10-22 (design gate r3, recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

Fix the silent skip and the false OK status in the `RunBacktest` symbol loop
(`services/xstockstrat-analysis/app/handlers/servicer.py`, recon.md:35-50). Unify the "owner cannot run this
formula" refusal so that an admin run and an owner run report the same reason. 275 lands after 272 and 273, and
rebases onto 215's landed gate and proto. 272 renames the body to `_run_backtest`. **Before `/sdd-spec` writes
steps, re-anchor every cited line on the merged state of 272, 273 and 215.** The `servicer.py` line numbers below
are pre-272 (recon.md:5-8).

### 1. Proto and UI, one commit (fails.md:81-83, recon.md:198-205)

- Add `NO_TRADE_REASON_EVALUATION_FAILED = 6` to `NoTradeReason` (`packages/proto/analysis/v1/analysis.proto:196-203`,
  recon.md:198). If 6 is taken by then, use the next free value. 5 belongs to 215.
- The proto comment draws the 6-vs-4 boundary by mechanism, as amended by operator option (a):
  - 6: the symbol was not evaluated because of an upstream RPC error or an unexpected exception during evaluation.
    Examples are a `GetBars` or `ComputeIndicator` status, or an `ExecuteFormula` status other than NOT_FOUND or
    PERMISSION_DENIED.
  - 4 (`FORMULA_ERROR`): errors the evaluator converts to `FormulaExecutionError`. These are an owner-unreadable
    formula (an indicators NOT_FOUND to the owner, or PERMISSION_DENIED to an admin caller) and formula contract
    errors.
- Also widen the `FORMULA_ERROR = 4` trailing comment to say it includes an owner-unreadable formula.
- Run `./scripts/buf-gen.sh` and commit the stubs. `buf lint`, `buf breaking` and `proto-freshness` must be green,
  and the analysis proto owner reviews. The change is additive; it needs no breaking-change approval.
- In the same commit, add the `NO_TRADE_MESSAGE` key in `BacktestDiagnostics.tsx:41-52`. The map is exhaustive
  (recon.md:86-88). The copy says the symbol was not evaluated and points to the run warnings. It must not start
  with "No trades —".

### 2. Formula refusal: map PERMISSION_DENIED (operator option (a))

- In `StrategyEvaluator._execute_formula` (`app/services/evaluator.py:254-266`, recon.md:59-63), the backtest path
  (`_raise_unreadable` set, `servicer.py:2035-2037`, recon.md:54-55) treats PERMISSION_DENIED like NOT_FOUND.
  Indicators returns PERMISSION_DENIED to an admin and NOT_FOUND to everyone else for the same unrunnable formula
  (`indicators/app/handlers/servicer.py:243-253`, recon.md:68-70). Both now raise
  `FormulaExecutionError(comp.formula_id, "not readable by owner")`.
- `FormulaExecutionError` gets an optional `code: str = ""` carrying the gRPC status name, set only by these two
  mapped refusals. Formula contract errors (indicators `resp.error`) leave it empty.
- The live-loop path (`_raise_unreadable` unset) is unchanged. NOT_FOUND still skips the component with the
  "not readable by owner" warning (@AC-5 @feature-224), and PERMISSION_DENIED still re-raises as before.
- The `except FormulaExecutionError` arm (`servicer.py:1112-1126`, recon.md:39) keeps its row and its
  `formula_errors += 1`. When `fe.code` is set, it also appends `(symbol, fe.code)` to `eval_failures` (§3), so the
  FORMULA_ERROR path carries the FR-3 warning. The warning has the status code name only.
- **Outcome.** An admin run and an owner run of the same legacy-author strategy both report
  `NO_TRADE_REASON_FORMULA_ERROR` (4) and are `INSUFFICIENT_DATA`. The warning names the scope-specific code:
  `backtest symbol AAPL not evaluated: PERMISSION_DENIED` (admin) or `…: NOT_FOUND` (owner). Neither includes
  `e.details()`, because the indicators PERMISSION_DENIED detail names the foreign author.

### 3. Loop handler (recon.md:39-40, :101-108)

- Replace `servicer.py:1127-1132` with `except _BarFetchError: raise` (272's re-raise, kept), then **one**
  `except Exception as e:` arm. There is no loop-level `except TimeoutError`. 272's run deadline arrives as
  `CancelledError`, a `BaseException`, and passes through (recon.md:219-222).
- The arm is written inline:
  - `code = e.code().name` when `e` is a `grpc.RpcError` with a callable `code()`, else `type(e).__name__`.
  - `symbol_intents.pop(symbol, None)`, because `:1046` buffers the PORTFOLIO intent before `_compute_metrics`
    runs at `:1050`.
  - A `SymbolDiagnostics` row following the `:1112-1126` template: `bars=[]`, reason `EVALUATION_FAILED`,
    `bars_total=0`, `warmup_bars=0` (recon.md:101-103).
  - Append `(symbol, code)` to `eval_failures: list[tuple[str, str]]`, declared beside `formula_errors` at `:905`
    (recon.md:33-34).
  - A server WARN with the symbol, `request.strategy_id`, `code`, the full `e`, and
    `dict(propagation_meta).get("x-trace-id", "")` (recon.md:29-31, :108-109). Use `.get`, never a subscript: a
    `KeyError` inside the arm would escape the loop. Add `exc_info=True` when `e` is not an `RpcError`.
  - No new context is minted (operator 2026-10-21 C-03 directive).
- Handler order alone keeps the earlier arms intact: `_InsufficientData`, `_FundamentalsUnavailable`,
  `_FundamentalsUnknown` and `FormulaExecutionError` are all caught above the new arm (`:1065-1126`, recon.md:35-39).
  A fundamentals `GetFormula` RpcError leaves as `_FundamentalsUnknown` (recon.md:56-58), so @AC-8 holds.

### 4. Status gate and warnings

- Add `eval_failures` to the `INSUFFICIENT_DATA` or-chain at `:1238` **only** (recon.md:41). The `:1320` recompute
  condition stays `status == OK or fund_refusals > 0` (recon.md:50, :141-142).
- A non-OK status already gives a null score and skips the detail and evidence writes (`:1279-1299`, `:1313-1314`,
  recon.md:45-49). FR-5 is therefore a regression guard here, not a change.
- After the `fund_unknown` block (`:1263-1266`, recon.md:43-44), add
  `EVAL_FAILED_WARNING.format(symbol=s, code=c)` to `result.warnings` for each entry in `eval_failures`. That covers
  both the new arm and the mapped formula refusals.
- `EVAL_FAILED_WARNING = "backtest symbol {symbol} not evaluated: {code}"` is a module constant next to
  `_PROPAGATED_HEADERS` (`:350`). It is a constant only because the tests import it. If `/sdd-spec` drops the test
  import, inline it as an f-string to match the `fund_unknown` sibling.
- `INSUFFICIENT_DATA` runs persist no detail (`:1313-1314`). The per-symbol rows live only in the in-memory
  `_backtests` (`:1267-1268`) and are lost on restart or a Past-Runs reload. The run-history row (null score, empty
  rating) persists. The product spec's run-history claim is scoped to say so.

### 5. Analysis tests, RED before GREEN

- AC-1 to AC-5 and AC-7; AC-6 once 272 has landed.
- (a) A per-symbol `TimeoutError` becomes an EVALUATION_FAILED row.
- (a') `CancelledError` propagates out of `_run_backtest`.
- (b) A run with both fund-refused and eval-failed symbols still recomputes. This pins @AC-11 @feature-215.
- (c) The WARN record carries the trace id. A variant with no `x-trace-id` in the inbound metadata still produces
  the row and does not raise. The `analysis.backtest.completed` `AppendEvent` receives `metadata=propagation_meta`
  on an all-failed run. That is already true at `:1344-1352`; the test only pins it.
- (d) In PORTFOLIO mode, a raise from `_compute_metrics` after the intent was buffered leaves the failed symbol out
  of the `_simulate_portfolio` input and out of the portfolio curve.
- (e) `_BarFetchError` still propagates past the broad arm. This is the AC-6 pin, and it keeps the single-arm design
  visible in review.
- (f) Rewritten for option (a):
  - An admin caller whose `ExecuteFormula` gets PERMISSION_DENIED produces a **FORMULA_ERROR** row and a
    `PERMISSION_DENIED` warning.
  - A non-admin owner whose call gets NOT_FOUND produces a FORMULA_ERROR row and a `NOT_FOUND` warning.
  - Both runs are `INSUFFICIENT_DATA`.
  - A formula contract error (no status code) produces a FORMULA_ERROR row and adds no new warning.
  - The live-loop evaluator (`raise_unreadable=False`) keeps NOT_FOUND → skip plus "not readable by owner"
    (@AC-5 @feature-224), and PERMISSION_DENIED still re-raises.
- (g) An `ExecuteFormula` UNAVAILABLE produces an EVALUATION_FAILED row and an `UNAVAILABLE` warning. This pins the
  6-vs-4 boundary.
- Tests reference `EVAL_FAILED_WARNING`, never a literal. Reuse `make_servicer`/`_owned_ctx`,
  `_diag`/`_bars`/`_squeeze`, the `AioRpcError` stub from `test_unreadable_formula.py:220-221`,
  `TestFormulaErrorSurfacing` and the `test_warmup.py:260` raises pattern (recon.md:110-117).

### 6. UI, with reachability (C-10, C-12, C-14, insights.md:165-175)

- Add an `INSUFFICIENT_DATA` run to `e2e/mock-backend.ts` with an empty `coverage_gaps` and one EVALUATION_FAILED
  row, following the `:1064-1086` pattern. Put its fixture in `e2e/fixtures/` with an `INVENTORY.md` catalog row,
  following the `:61-62` pattern.
- Clone a Playwright spec from `e2e/insights/backtest-coverage.spec.ts:97`. It asserts that the new
  `NO_TRADE_MESSAGE` text renders through the `page.tsx:569-574` path, and that `data-testid="backtest-warnings"`
  (`page.tsx:509-516`) shows the warning (recon.md:89-94). A passing `tsc` is not enough.
- No new component. The view already renders `warnings`, `diagnostics` and `INSUFFICIENT_DATA` (recon.md:89-94).

### 7. Consumer surfaces and docs, same PR (strat-lab same-PR rule, fails.md:307-309)

- **Agent `run_backtest`.** No agent code change; the result is passed through and enum names project
  automatically (recon.md:72-82). In the docstring (`services/xstockstrat-agent/app/tools.py:739-778`), `:749-750`
  becomes: "An INSUFFICIENT_DATA run gets no attachment. Its coverage gaps, warnings and per-symbol diagnostics are
  inline. An all-failed run has coverage_gaps: [] but non-empty diagnostics with NO_TRADE_REASON_EVALUATION_FAILED
  or NO_TRADE_REASON_FORMULA_ERROR." This is grounded in `backtest_view.py:73-74`, `:82-85` and `:97-100`.
- **`docs/runbooks/mcp-tools.md:308-310`.** The same contract.
- **strat-lab `backtest` skill.**
  - `SKILL.md:164-173` and `reference/output-handling.md:21-26`: reason 6, the
    `backtest symbol <SYM> not evaluated: <CODE>` warning, and the note that FORMULA_ERROR now also covers an
    owner-unreadable formula for both admin and owner callers.
  - `reference/self-grill.md:33-39` (§6): the same items, with the option (a) text replacing the round-3
    "asymmetry" wording.
  - `reference/verification.md:26-33`: correct the silent non-evaluation line.
  - `reference/backfill.md`: add the discriminator. `SKILL.md:99-100` teaches "INSUFFICIENT_DATA → trigger_backfill
    → re-run".
- **The discriminator** (for `SKILL.md` and `backfill.md`):
  - INSUFFICIENT_DATA with an empty `coverage_gaps` and EVALUATION_FAILED or FORMULA_ERROR rows: never backfill.
  - A warning code of UNAVAILABLE, DEADLINE_EXCEEDED or RESOURCE_EXHAUSTED: rerun later.
  - A warning code of PERMISSION_DENIED or NOT_FOUND, or a Python exception class name (for example `ValueError`):
    report it. This is a platform defect or an ownership problem, not a data gap.
- **`services/xstockstrat-analysis/CLAUDE.md` § Backtest Auto-Scoring** (`:109`): "0 score" → "null score"
  (recon.md:262-263).
- **Teardown.** Run the context-forge refresh, or record a manual reconciliation in the PR body (fails.md:670).
- **UI `/insights` backtest view.** §6.

### 8. Exception inventory

The adversary verified the exceptions reachable from the loop body. Only `_BarFetchError` and `CancelledError` must
pass through today. `/sdd-spec` keeps a checklist step that re-greps every `raise` and custom exception class
reachable from the loop on the merged 272/273/215 tree, and lists any new sentinel above the broad arm.

## Rejected Alternatives

- Reuse `NO_TRADE_REASON_FORMULA_ERROR = 4` for every failure. The meaning is wrong for `GetBars` and
  `ComputeIndicator` RPC failures and for generic exceptions (`analysis.proto:196-203`), and it blurs the skill's
  formula-error signal.
- Two new enum values (`RPC_FAILED` and `UNEXPECTED_ERROR`). This is YAGNI: the warning code already tells them
  apart, and each value costs another exhaustive UI map key.
- Map every error inside `_execute_formula` (`evaluator.py:254-266`). This does not cover `GetBars`,
  `ComputeIndicator` or generic exceptions (FR-1/FR-2), and it would turn an indicators outage into a formula error.
- Option (b): record the admin-PERMISSION_DENIED (6) vs owner-NOT_FOUND (4) asymmetry and leave it. This was the
  mediator's recommendation. The operator chose (a) at the round-3 gate, so one fact gets one reason regardless of
  caller scope.
- Let unexpected exceptions propagate as INTERNAL. This contradicts FR-2/AC-3, and one bad symbol would kill a
  multi-symbol run.
- Fail the whole RPC (FAILED_PRECONDITION or INTERNAL) on an all-failed run. This contradicts FR-2, FR-4 and FR-6,
  loses the run-history row, and adds a third outcome. The docs discriminator separates platform defects at lower
  cost.
- A loop-level `except TimeoutError: raise`. It is redundant for 272's deadline, which arrives as `CancelledError`,
  and harmful for per-symbol timeouts, which it would escalate to a run-level UNKNOWN.
- Two arms (`except grpc.RpcError` plus `except Exception`), or a `_record_eval_failure` helper. This duplicates the
  row, counter and warning bodies (C-18 DRY). One arm with an `isinstance` check, plus test (e), keeps the arm
  visible in review.
- Add `eval_failures` to the `:1320` recompute condition. This would CHANGE @AC-11 @feature-215 and is unnecessary,
  because the status gate already handles the score and the writes.
- Put `e.details()` in the client warning. It leaks the foreign formula author from the indicators PERMISSION_DENIED
  detail. The full detail goes to the server log only.
- Read the trace id as `dict(propagation_meta)["x-trace-id"]`. When the caller sent no trace id, a `KeyError` inside
  the arm would escape the loop. Use `.get(..., "")`.
- Map PERMISSION_DENIED in the live-loop path too. That is outside 275's backtest scope and would CHANGE
  @AC-5 @feature-224. The mapping is gated on `_raise_unreadable`.

## Open Risks

- [ ] Merge-order drift. 272, 273 and 215 rewrite the same `RunBacktest` lines. Re-anchor every cited path:line
  (`servicer.py:350`, `:806-810`, `:905`, `:928`, `:1046-1051`, `:1065-1132`, `:1238`, `:1263-1266`, `:1320`,
  `:1344-1352`; `evaluator.py:100-110`, `:254-266`) and re-check enum value 6 for a collision. Owner: `/sdd-spec`
  re-anchor step.
- [ ] If 272's deadline lands as a `wait_for` inside the loop rather than an `asyncio.timeout` around
  `_run_backtest`, revisit the decision not to re-raise `TimeoutError`. Owner: `/sdd-spec` re-anchor step.
- [ ] 272 error taxonomy. A `GetBars` UNAVAILABLE must stay a raw `grpc.RpcError`, not wrapped in `_BarFetchError`,
  for AC-2 and AC-5. Re-grep 272's landed `_fetch_bars_paged`. Owner: `/sdd-spec` re-anchor step.
- [ ] The broad `except Exception` arm. A future sentinel exception would silently become a row unless it is listed
  above the arm. The guards are the grep checklist step (§8) and test (e). Owner: `/sdd-spec` checklist step.
- [ ] Option (a) reading. The operator's "FR-3-style warning on the FORMULA_ERROR path" is read as applying to the
  RPC-mapped refusals (NOT_FOUND and PERMISSION_DENIED), which carry a status code. Formula contract errors carry no
  status code and keep their current no-warning behavior. If the reviewer reads the decision as covering contract
  errors too, the operator confirms. Owner: `/sdd-review impl-spec`.
- [ ] The PERMISSION_DENIED mapping keys on the status code alone. Any future indicators PERMISSION_DENIED from
  `ExecuteFormula` on the backtest path becomes FORMULA_ERROR. This is correct for today's contract
  (`indicators servicer.py:243-253`). Owner: the analysis evaluator step re-checks the indicators handler.
- [ ] Consumers trained on "INSUFFICIENT_DATA means backfill" (`SKILL.md:99-100`) may backfill needlessly until the
  discriminator ships in `SKILL.md` and `backfill.md`. Owner: the docs step.
- [ ] An `INSUFFICIENT_DATA` run persists no detail, so the per-symbol failure rows are lost on restart or a Past-Runs
  reload. This is pre-existing and required by FR-5, and is documented in the product spec. Owner: the docs step.
- [ ] A partial run whose only evaluated symbol is flat with zero trades becomes `INSUFFICIENT_DATA`. Accepted under
  FR-6. Owner: test for AC-5.
- [ ] Proto and UI coupling. The UI key must land in the same commit as the stubs. The change needs analysis
  proto-owner review and green `buf lint`, `buf breaking` and `proto-freshness`. Owner: the proto + UI step.
- [ ] `exc_info=True` writes one stack trace per failed symbol. This is bounded by the size of the universe and
  accepted.
- [ ] Out of scope: the root trigger (formulas stored under the legacy username author) stays tracked in
  `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`. Affected backtests now surface as
  `INSUFFICIENT_DATA` with FORMULA_ERROR rows and a PERMISSION_DENIED (admin) or NOT_FOUND (owner) warning.

## Constitution Rules Touched

- `C-03`: honored. The trace id comes from the run-scoped `propagation_meta` and no context is minted. The
  completed-event `AppendEvent` keeps `metadata=propagation_meta`, pinned by test (c). There is no waiver
  (operator 2026-10-21).
- `C-10`, `C-14`: honored. The change reaches every consumer surface: the agent `run_backtest` docstring and
  `mcp-tools.md`, the strat-lab skill, and the `/insights` backtest view. A Playwright spec proves the new reason
  renders (§6).
- `C-11`: honored. Every fork was raised at the gate. The operator resolved the formula-refusal asymmetry with
  option (a) and signed off the @AC-5 @feature-150 correction.
- `C-12`, `C-13`: honored. The new UI fixture lives in `e2e/fixtures/` with an `INVENTORY.md` row. The analysis tests
  reuse the existing harness and stubs.
- `C-15`: honored. `acceptance.feature` is amended for option (a). AC-1 now names FORMULA_ERROR, and AC-7 covers the
  owner NOT_FOUND path.
- `C-16`: honored. See Business Rules Touched.
- `C-18`: honored. There is one broad arm, one warning constant and one `eval_failures` list shared by both arms. No
  helper and no duplicated row body.
- `P-02` / `P-03`: honored. The product spec and acceptance are amended for the operator decisions instead of
  widening scope silently. The option (a) reading is recorded as an open risk.
- `PLAT-N1`: honored. The docs discriminator stops consumers from treating an evaluation failure as a data gap.
- Floor (`F-*`): no Floor item is touched. There is no migration, config key, pool change or secret. No breach.
- Ledger: `fails.md:118-133` (a graceful skip must never be silent; this fix closes one), `fails.md:81-83`
  (exhaustive TS map, same commit), `fails.md:307-309` (same-PR agent docs), `fails.md:670` (Teardown),
  `insights.md:165-175` (reachability of the new reason).

## Business Rules Touched (C-16)

- CHANGE 275 `@AC-1`–`@AC-4`: an all-failed run is `INSUFFICIENT_DATA` with typed rows and warnings, not OK.
  Signed off by user @ 2026-10-22 (triage decision, context.md). AC-1's expected reason is now FORMULA_ERROR, signed
  off by user @ 2026-10-22 (design gate r3, option (a), context.md).
- EXTEND 275 `@AC-5`: a partial run stays OK and reports the failed symbol. Covered by the 2026-10-22 triage
  decision.
- PRESERVE 275 `@AC-6`: `_BarFetchError` still fails the run with FAILED_PRECONDITION. Not regressed: 272's re-raise
  sits above the broad arm, pinned by test (e) (operator "keep 272's re-raise" directive).
- EXTEND 275 `@AC-7` (new, option (a)): an owner run whose formula is unreadable reports FORMULA_ERROR with a
  `NOT_FOUND` warning. Signed off by user @ 2026-10-22 (design gate r3).
- EXTEND `@AC-30 @FR-3 @feature-224` "Registering a strategy that references an unreadable formula warns at write
  time" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`). New case: on the
  backtest path, the unreadable-formula refusal maps to `FormulaExecutionError` for PERMISSION_DENIED (admin) as
  well as NOT_FOUND, and the FORMULA_ERROR row carries a status-code warning. The write-time warning is unchanged.
  Signed off by user @ 2026-10-22 (design gate r3, option (a), context.md).
- CHANGE `@AC-5 @FR-4 @feature-150` "The derived grade is unchanged by portfolio mode"
  (`services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature`). A symbol whose `_compute_metrics`
  raises after its intent was buffered is now excluded from `_simulate_portfolio` and from the portfolio curve. This
  is an intentional correction. Signed off by user @ 2026-10-22 (design gate r3, decision 1, context.md). Pinned by
  test (d).
- PRESERVE `@AC-5 @FR-3 @feature-224` "analysis cannot execute a formula its strategy owner does not own". Not
  regressed: the live-loop path is unchanged and the mapping is gated on `_raise_unreadable`. Pinned by test (f).
- PRESERVE `@AC-11 @FR-9 @feature-215` "The derived grade excludes refused symbols without deleting evidence". Not
  regressed: the `:1320` recompute condition is unchanged. Pinned by test (b).
- PRESERVE `@AC-8 @FR-8 @feature-215` "A fundamentals outage is not reported as absence". Not regressed:
  `_FundamentalsUnknown` is caught above the new arm, and the loader converts the RpcError to UNKNOWN.
- PRESERVE `@AC-2`, `@AC-5`, `@AC-13 @feature-215`. Reason 5 is unchanged and the opportunities path is untouched.
- PRESERVE `@AC-11 @feature-151` (`services/xstockstrat-ui/acceptance/backtest-next-bar-fill.feature`) and
  `@AC-6 @FR-4 @feature-151`. Not regressed: the new rows have `bars=[]` and add no per-bar rendering.
- PRESERVE `@AC-4 @feature-152`, `@AC-3 @feature-149`, `@AC-21 @feature-224`, `@AC-28`/`@AC-1 @feature-224`
  (indicators), `@AC-2`/`@AC-10 @feature-225`, `@AC-8 @feature-198`, `@AC-32 @feature-224` (platform docs parity).
  Not regressed: those paths are untouched, and the docs edits keep `list_templates`/`instantiate_template` and
  never mention `is_public`/`include_public`.

## Rounds

- Round 1 opened the forks: reason channel, mapping site, and warning content.
- Round 2 settled the core design: value 6, a single inline arm, gating `:1238` only, and the warning constant.
- Round 3 closed seven round-2 objections. It added the backfill discriminator, the no-trace-id `.get`, the
  Playwright reachability line, the @AC-5 @feature-150 reclassification and the exception inventory. It surfaced the
  formula-refusal asymmetry.
- Termination: approved at the round-3 gate. Adversary verdict SOUND, no Floor breach. The operator chose option (a)
  and signed off the @AC-5 @feature-150 correction.
