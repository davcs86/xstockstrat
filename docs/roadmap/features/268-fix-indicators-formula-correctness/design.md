# Design: fix-indicators-formula-correctness

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: operator @ 2026-10-22 (design gate after round 2: "APPROVED as synthesized"; no Floor breach)
**Grounded in**: recon.md

---

## Chosen Approach

The fix is in `xstockstrat-indicators`, plus two description strings in `xstockstrat-ui`. It needs no proto,
migration, config or analysis change. D-18 takes **Option A** (OQ-1 = A), so OQ-2 is moot. `packages/proto` and
`xstockstrat-analysis` are now unchanged consumers. `xstockstrat-ui` joins the affected services because its
static catalog repeats the misleading names (recon.md:65-67, :152-154; C-10).

Build order: D-54, then D-10, then D-18 (engine and UI), then docs. No step adds an outbound call.

### Step A: D-54, pending-hidden rows are NOT_FOUND on mutation (`app/handlers/servicer.py`)

- After the raw `get_by_id` in `UpdateFormula` (recon.md:24, `servicer.py:490`) and in `DeleteFormula`
  (recon.md:26, `servicer.py:593`), widen the guard to
  `if row is None or row.get("pending_intent_id") is not None:`. This is the same predicate `_load_formula`
  uses at `servicer.py:156` (recon.md:22-23, :78-80).
- Keep the existing NOT_FOUND abort and its message unchanged (recon.md:81-82). A pending row then looks the
  same as a missing one, which keeps the no-existence-leak rule (`@AC-1@feature-224`).
- Resulting check order:
  - Update: missing or pending → SYSTEM_AUTHOR (`:496`) → owner (`:502`) → deleted_at.
  - Delete: missing or pending → SYSTEM_AUTHOR (`:599`) → owner.
- The repo SQL is not changed.
- Tests use real `indicators_pb2` messages (fails.md trap, recon.md:167-168), one test per guard branch
  (fails.md 063, recon.md:165-166):
  - missing, pending, system, foreign owner, ADMIN on a foreign row, and deleted (Update only);
  - a pending row authored by SYSTEM_AUTHOR → NOT_FOUND (shows the pending check runs first);
  - a pending foreign row called by ADMIN → NOT_FOUND.
- Every pending-row test asserts that `repo.update` / `repo.delete` was never awaited (AC-6, AC-7).
- **C-13:** the row variants (pending, system-pending, foreign, deleted) come from one builder in
  `services/xstockstrat-indicators/tests/conftest.py`, or from an existing row fixture there if one exists. No
  inline dict copies.

### Step B: D-10, a run without parseable output fails (`app/services/sandbox.py`)

- **Marker framing (choice recorded): leading `\n`.** The wrapper's output print (`sandbox.py:312`, recon.md:31)
  prints `"\n__OUTPUT__:" + json.dumps(...)`, so the marker always starts its own line, even after
  `print(..., end="")`.
  - The parent keeps `startswith` per line, so marker text inside a user's printed line never matches.
  - Rejected: parent-side `rfind`, because it can match a marker inside user text.
  - The `_fake_popen` default `"__OUTPUT__:{}"` (`tests/test_sandbox_isolation.py:60`) still parses under
    per-line `startswith`.
  - Cost: one blank line before the marker in raw stdout (see Open Risks).
- **Parse loop** (`:394-400`, recon.md:32-33): keep the raw text of the **last** line that starts with
  `__OUTPUT__:`, and stop swallowing `JSONDecodeError` inside the loop.
- **One failure constructor (C-18).** Add a local closure `_fail(error, exit_reason)` inside `execute_formula`.
  It builds the existing `SandboxResult(success=False, output={}, ...)` shape from `:408-417` (recon.md:71-73),
  so the failure result has only one construction site.
  - It carries `stdout`/`stderr` through, because the `/insights` run result renders them
    (`FormulaRunResult.tsx:92-98`) and so does agent `test_formula` (`tools.py:1486`).
  - The non-zero-exit (rc≠0) return uses `_fail`. The stderr classification at `:403-407` is unchanged
    (recon.md:34).
  - The rc≠0 error becomes `stderr.strip()[-500:] or f"formula exited with code {proc.returncode} before producing output"`.
    FR-1 requires a **non-empty** `error` (product-spec FR-1), and `raise SystemExit(1)` / `SystemExit(2)` leave
    stderr empty. `exit_reason` keeps its classified value (`runtime_error`).
  - The timeout branch (`:378-390`) is untouched and is not routed through `_fail`.
- **Only when `returncode == 0`** (after `:402`; recon.md:136-140), so timeout, memory_exceeded and
  import_blocked are never relabelled:
  - no marker line → `_fail("formula produced no output", "runtime_error")`;
  - `json.loads` fails on the last marker line → `_fail(f"formula output could not be parsed: {e}", "runtime_error")`;
  - otherwise the existing success return (`:419-428`, recon.md:35).
  - `runtime_error` maps to `SANDBOX_EXIT_REASON_RUNTIME_ERROR` at `servicer.py:313-319` (recon.md:27), so no new
    enum value is needed (recon.md:61).
  - The error strings match AC-1 ("produced no output") and AC-2 ("could not be parsed").
- The restricted builtins at `:252` are unchanged (recon.md:29-30).
- Tests (`tests/test_sandbox.py`):
  - AC-1: `raise SystemExit(0)`.
  - AC-2: print `__OUTPUT__:{`, then `SystemExit(0)`.
  - AC-3: `result = {'x': 1}`.
  - `result` set, then `print("x", end="")` → success with the correct output.
  - `os._exit(0)` → no output.
  - `raise SystemExit(1)` → `success=false` with a non-empty error.
  - Re-run the `@feature-228` matrix and the `@feature-209` kill tests unchanged.
  - One servicer-level test with real pb2 messages asserts `exit_reason == SANDBOX_EXIT_REASON_RUNTIME_ERROR`.
  - Existing success asserts at `test_sandbox.py:24`, `:120`, `:141` (recon.md:145-148) must still hold. Each
    of those formulas emits output.

### Step C: D-18 Option A, honest descriptions (`app/services/indicators_engine.py` + UI catalog)

- Replace the descriptions at `indicators_engine.py:141-142` (recon.md:41):
  - ATR → `"ATR (close-to-close approximation): rolling mean of |close change| over period; not Wilder's true range"`
  - VWAP → `"VWAP (running mean approximation): cumulative mean of closes; no volume weighting"`
- Correct the `_atr`/`_vwap` docstrings (`:103-116`, recon.md:39-40).
- Keys, dispatch (`:30-31`, recon.md:38) and math are unchanged, so analysis consumers (recon.md:49-55) and
  stored strategies keep resolving, with identical numbers.
- Mirror both strings into `services/xstockstrat-ui/src/lib/strategyCatalog.ts:99` and `:104` (recon.md:66-67).
- Add `src/lib/strategyCatalog.test.ts` (vitest). Its only assertion: no "Average True Range" or
  "Volume Weighted Average Price" text remains.
- Tests for AC-4/AC-5, at engine level and servicer level:
  - the `ListIndicators` text;
  - unchanged `ComputeIndicator` values: ATR `[1.5, 1.5]`, VWAP `[10, 15, 20]`.

### Step D: docs and defect filing

- Indicators `CLAUDE.md`:
  - the sandbox failure rule (no output, unparseable output, empty-stderr non-zero exit);
  - the ATR/VWAP approximation note under § Role.
- `docs/runbooks/indicator-builder.md`: the same approximation note.
- Indicators `docs/context-constitution-findings.md`: record that trading's ATR(14) (`trading.go:3168-3235`) is true
  Wilder ATR and differs from the indicators built-in.
- File `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md` with a `.status` sidecar set to
  `open`. It covers the out-of-scope gap: a formula that never assigns `result` still succeeds with `{}`
  (`sandbox.py:310-311`, recon.md:141-144).
- Product-spec housekeeping at `/sdd-spec`:
  - Affected Services: add `xstockstrat-ui`; mark analysis and proto as "consumer, unchanged".
  - Fix Scope: settle the proto checkbox as "no proto change (Option A)".

### Consumer surfaces (C-14)

- `/insights` formula workspace: `FormulaRunResult` now shows **Failed** with the cause for no-output and
  unparseable runs (FR-1).
- Agent `test_formula`: returns the same failure (FR-1).
- Agent `manage_formula` update/delete: returns NOT_FOUND on pending rows (FR-5).
- `/insights` strategy catalog: shows the honest ATR/VWAP text (FR-3/FR-4).
- Agent `run_backtest`/`screen_symbols`: numbers are unchanged under Option A.

### Downstream consumers of `success=false` (verified; closes the feature-246 re-check)

All three fail closed. No consumer code change is needed:

- `fundamentals_scoring.py:61-63` raises `FundamentalsScoringError`, and `fundsignal_loop.py:465` turns it into a
  per-symbol skip.
- `screener.py:353-354` returns `None`.
- `evaluator.py:133` raises `FormulaExecutionError` (recon.md:47-48).

### C-15 note (corrects the round-2 synthesis)

The round-2 synthesis said product-spec.md has no FR-N list. That is stale. The committed product-spec already
defines FR-1..FR-5, and every scenario in acceptance.feature already carries its `@FR-N` tag. No FR or tag
addition is needed.

This design deletes the losing Option B scenarios, `@AC-8` and `@AC-9`, from acceptance.feature, as the product
spec requires. It keeps `@AC-4`/`@AC-5` (`@option-A`).

## Rejected Alternatives

- **D-18 Option B** (true Wilder ATR and volume-weighted VWAP from OHLCV) — rejected:
  - it needs the proto gate and plumbing at 4 analysis sites (`evaluator.py:496`, `screener.py:294`/`:360`,
    `pnl_pattern_consumer.py:98`) plus a warm-up recheck;
  - it invalidates stored grades (OQ-2);
  - that is too much rework for a SEV-2 fix (recon.md:155-160).
- **Renaming the keys (e.g. `CLOSE_ATR`)** — rejected: it breaks key stability (FR-3/FR-4) and every stored
  strategy definition and fingerprint.
- **Stripping `SystemExit`/`KeyboardInterrupt`/`GeneratorExit` from the builtins (`sandbox.py:252`)** — rejected:
  - it misses `os._exit(0)` and frame-traversal exits;
  - it turns AC-1 into a NameError instead of "produced no output";
  - parent-side detection is the right layer.
- **Catching SystemExit in the wrapper only, plus a sentinel** — rejected: it does not cover `os._exit` or
  traversal exits.
- **Keeping "last parseable line" plus a `saw_output` flag** — rejected: the result for AC-2 is not
  deterministic. Strict parsing of the last marker line wins.
- **Running the no-output check before the rc≠0 branch** — rejected: it would relabel timeout, memory_exceeded
  and import_blocked (`@feature-228`, `@feature-209`).
- **Parent-side `rfind` marker framing** — rejected: it can match a marker inside user text.
- **A new `SandboxExitReason` enum value** — rejected: needless proto churn. `RUNTIME_ERROR = 4` and the
  declared-outputs precedent (`servicer.py:336`) suffice.
- **Adding `AND pending_intent_id IS NULL` to the repo UPDATE/DELETE SQL** — rejected:
  - a row only moves from pending to visible (`formulas_repository.py:141-147`), so there is no mutation race;
  - an ambiguous `None` return would need remapping;
  - the servicer guard is enough.
- **A per-run nonce in the output marker** — rejected: spoofing gains no privilege, since the author already
  controls `result`, and frame traversal could read the nonce anyway.
- **Deleting `@AC-4`/`@AC-5`** — rejected: Option A satisfies them, so deleting them only loses coverage.
- **Recording the UI catalog drift only in context.md** — rejected: it is not a C-14 deferral, and the fix is
  two strings.
- **Error suffix "(exited before result was emitted)"** — rejected: it states the wrong cause in marker-framing
  cases. The neutral "formula produced no output" still meets AC-1.

## Open Risks

- [ ] **D-10 is a visible behavior change.** Formulas that silently produced nothing now fail with
  `RUNTIME_ERROR`. `/insights` and `test_formula` show Failed, and strategies that relied on empty output stop
  scoring. The consumers fail closed (see above). To be addressed at: the D-10 step, by documenting the change in
  indicators `CLAUDE.md` and the PR body.
- [ ] **Raw stdout gains one blank line before the marker** (leading-`\n` framing). No test pins exact stdout
  (`test_sandbox_isolation.py:256` is a "not in" check), but external consumers that diff stdout could notice.
  To be addressed at: the D-10 step, by naming it in the PR body.
- [ ] **A formula can still forge success** by printing a valid marker line and then calling `SystemExit(0)`.
  Accepted: it is the author's own output and not an isolation breach. To be addressed at: the D-10 step, as a
  note in indicators `CLAUDE.md`.
- [ ] **"ATR" means two different numbers on the platform**: the indicators close-to-close approximation and
  trading's Wilder ATR(14) (`trading.go:3168-3235`). Mitigated by documentation only. To be addressed at: the
  docs step, in the indicators findings doc.
- [ ] **Accepted debt: the ATR/VWAP description text is duplicated** in `indicators_engine.py:141-142` and
  `strategyCatalog.ts:99`/`:104`, so it can drift again. Named follow-up: source the UI catalog from
  `ListIndicators` (`servicer.py:355-364`). To be addressed at: a follow-up after launch, out of this feature.
- [ ] **Assumption not re-verified: the saga commit/abort paths never go through `UpdateFormula`/`DeleteFormula`**
  (`@AC-19@feature-224`). To be addressed at: `/sdd-spec` (grep to confirm before writing the D-54 step).
- [ ] **Rebase conflicts.**
  - 244-fix-python-config-stored-zero also edits `sandbox.py` (`:282`, `:345-346`).
  - Peer batch features touch `servicer.py` (e.g. 269 template RPCs).
  - To be addressed at: `/sdd-spec` / execute, by sequencing in merge-order and rebasing whichever lands second.
- [ ] **The "never assigns result" gap stays a silent success** until the new defect report is triaged. To be
  addressed at: the docs step (file the report), then `/sdd-triage`.

## Constitution Rules Touched

- `C-01`: honored. The `_fail` result keeps `stdout`/`stderr`, because the `/insights` run result
  (`FormulaRunResult.tsx:92-98`) and agent `test_formula` (`tools.py:1486`) render them. Each change stays inside
  the service that owns it.
- `C-03`: honored, untouched. No new outbound calls or writes, so trace propagation is unchanged (operator
  standing decision 2026-10-21).
- `C-08`: honored. Each code step pairs with its tests (red before green).
- `C-10`: honored. The duplicated UI catalog surface (`strategyCatalog.ts`) is fixed in the same feature, and
  `xstockstrat-ui` joins the affected services.
- `C-11`: honored. Full-mode debate, 2 rounds, operator approval at the gate. OQ-1 is resolved as A.
- `C-13`: honored. The formula-row variants come from one `tests/conftest.py` builder; no inline dict copies.
- `C-14`: honored. Each consumer surface (the `/insights` run result and catalog, agent `test_formula` and
  `manage_formula`) is reached in-feature.
- `C-15`: honored. AC-1..AC-7 already carry `@FR-1..@FR-5`, and the losing `@option-B` pair (`@AC-8`/`@AC-9`)
  is deleted.
- `C-16`: honored. See Business Rules Touched. Every CHANGE is covered by the operator scope decision.
- `C-18`: honored. One `_fail` construction for the failure result, with no copied `SandboxResult` blocks.
- `P-02`: honored. Proposer and adversary were mediated through the synthesized state only.
- `P-03`: honored. The feature-246 deferral is closed with verified citations, and assumptions not re-verified
  are listed under Open Risks.
- `P-06`: honored. Operator decisions are recorded in context.md.
- `F-01`: honored. No secrets, credentials or config keys are touched.
- `F-06`: honored. No migration, and no edit to an applied migration.
- `F-07`: honored. No proto change, so `buf breaking` is not engaged. Option B was rejected partly for this reason.

## Business Rules Touched (C-16)

### This feature's own scenarios (`acceptance.feature`)

- CHANGE `@AC-1` "A formula that exits before producing output is reported as a failure". An implicit empty
  success becomes a failure. Signed off: operator scope decision D-10/D-18/D-54 (2026-10-21) and design gate r2
  "APPROVED as synthesized" (2026-10-22), both recorded in context.md.
- CHANGE `@AC-2` "A formula whose only output line does not parse is reported as a failure". Signed off: same
  operator decisions (2026-10-21 scope; 2026-10-22 gate r2).
- PRESERVE `@AC-3` "A formula that assigns result still succeeds". Not regressed: the success return at
  `:419-428` is kept.
- CHANGE `@AC-4` "The ATR built-in is described as the close-to-close approximation it computes". The advertised
  description changes. Signed off: same operator decisions (2026-10-21 scope; 2026-10-22 gate r2, OQ-1 = A).
- CHANGE `@AC-5` "The VWAP built-in is described as the running mean it computes". Signed off: same operator
  decisions (2026-10-21; 2026-10-22).
- CHANGE `@AC-6` "UpdateFormula refuses a pending-hidden saga copy". Signed off: same operator decisions
  (2026-10-21; 2026-10-22).
- CHANGE `@AC-7` "DeleteFormula refuses a pending-hidden saga copy". Signed off: same operator decisions
  (2026-10-21; 2026-10-22).
- `@AC-8`/`@AC-9` (`@option-B`) are removed as the losing D-18 option. They were never promoted.

### Promoted rules (durable suites)

- EXTEND `@AC-1@feature-224` "Another user's formulas are invisible even if formerly public"
  (`services/xstockstrat-indicators/acceptance/private-by-default-templates.feature`). New case: pending-hidden
  rows also return NOT_FOUND on Update/Delete, within operator-scoped D-54.
- PRESERVE `@AC-6@feature-224` "The fundamentals loop still runs the system scoring formula"
  (`docs/sdd/business-rules/platform.feature`). The seeded system formula still emits output.
- PRESERVE `@AC-18@feature-224` "Strategy template instantiation deep-copies referenced formulas"
  (`platform.feature`). The saga is unchanged.
- PRESERVE `@AC-19@feature-224` "A failed deep copy leaves nothing behind" (`platform.feature`). Pending rows
  stay hidden and now cannot be mutated either. The saga path is to be re-confirmed by grep at `/sdd-spec`.
- PRESERVE `@AC-23@feature-224` "System special-cases are unchanged" (`platform.feature`). A non-pending system
  formula stays PERMISSION_DENIED.
- PRESERVE `@AC-28@feature-224` "Admins can read but not change another user's objects"
  (`private-by-default-templates.feature`). ADMIN on a non-pending foreign row stays PERMISSION_DENIED.
- PRESERVE `@AC-1@feature-228`..`@AC-5@feature-228` (`fix-indicators-sandbox-matrix.feature`). The no-output
  check runs only on `returncode == 0`, so the memory, OpenBLAS and baseline classifications are unchanged.
- PRESERVE `@AC-3@feature-209` "An infinite-loop / memory-bomb formula is terminated deterministically" and
  `@AC-4@feature-209` "A legitimate formula evaluates to the identical result as before isolation"
  (`indicators-sandbox-os-isolation.feature`). The timeout branch is untouched, and normal formulas still emit
  output.
- PRESERVE `@AC-1@feature-225`, `@AC-10@feature-225`, `@AC-11@feature-225`
  (`private-by-default-enforce-contract.feature`). The identity gate, the non-owner NOT_FOUND and the UpdateFormula
  write columns are unchanged.
- PRESERVE `@AC-5@feature-205` "Test a fundamentals-scoring formula with supplied values" and `@AC-7@feature-205`
  "An authored fundamentals formula behaves identically as a strategy component". Successful runs are unchanged.

## Rounds

- **Round 1 (full)**: the proposer chose Option A with the parent-side no-output check and the inline pending
  guard. The adversary raised a blocking C-10 objection (UI catalog duplication not addressed). Not approved.
- **Round 2 (full)**: the proposer committed to the `strategyCatalog.ts` edit, the vitest and the affected-services
  update, which closed C-10. The adversary's remaining objection (empty error on `SystemExit(1)`) was folded in as
  the rc≠0 fallback, which product-spec FR-1's non-empty-error requirement makes mandatory.
- **Termination**: approved. Operator approval at the gate on 2026-10-22, with no Floor breach and no unsanctioned
  CHANGE.
