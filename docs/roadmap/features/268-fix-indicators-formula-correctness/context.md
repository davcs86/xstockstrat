# Context Log: fix-indicators-formula-correctness

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-indicators-formula-correctness-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-10, D-18, D-54.
- Severity: SEV-2 (group severity; D-54 alone was rated one tier lower by the surveyor). Impact type:
  wrong-indicator-output. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..7), context.md.
- Affected services: xstockstrat-indicators (fix site); xstockstrat-analysis (ATR/VWAP consumer); packages/proto
  only if D-18 adds OHLCV input.
- Root cause hypothesis: D-10 success inferred from return code alone plus `BaseException` subclasses admitted to
  formula builtins; D-18 the 1-D `values` contract cannot carry high/low/volume and the approximations kept the real
  names; D-54 the mutating RPCs bypass `_load_formula`'s pending-hidden check.
- Re-verification on main-dev @ a053b0e: all three reproduce in code. Line drift: D-10 `sandbox.py:252`, `:399`
  unchanged (output print `:310-312`, success return `:419-427`); D-18 `indicators_engine.py:103-116`, `:141-142`
  unchanged; D-54 moved — `UpdateFormula` `get_by_id` `:483` → `:490`, `DeleteFormula` `:586` → `:593`,
  `_load_formula` `:146-151` → `:150-157`.
- **D-18 changes historical backtests**: either fix (true OHLCV ATR/VWAP or rename) changes numeric output for every
  strategy/backtest using them; stored grades built on the approximations will not reproduce. Design must decide
  communication and whether grades are recomputed. `ComputeIndicatorRequest` (`indicators.proto:54-61`) has only
  `values`, so the true-indicator path is a proto change (Proto Reviewer + `buf breaking`).
- **Overlaps:**
  - Hotfix `3340a7c` (sandbox override clamp, `_clamp_override` in `servicer.py` `ExecuteFormula`) is already in
    HEAD; it does not touch `sandbox.py` or `UpdateFormula`/`DeleteFormula`. Rebase-safe; no functional overlap.
  - 243-fix-sandbox-seed-keys (`implementation-ready`): its implementation spec (on `origin/feature/fix-sandbox-seed-keys`)
    touches indicators `CLAUDE.md`, `docs/context-constitution-findings.md`, `tests/test_config_watcher.py` and a config-service
    seed-heal migration (`031_heal_indicators_sandbox_keys_full_dotted`) — not `sandbox.py`/`servicer.py` code. Expect a doc conflict in indicators `CLAUDE.md` only.
  - 244-fix-python-config-stored-zero (`implementation-ready`) edits `sandbox.py:282`, `:345-346` (memory guard,
    `RLIMIT_NPROC`) and `servicer.py` `ExecuteFormula` config reads — same file as D-10, different region; sequence via
    `merge-order.md`.
  - Open adjacent reports (not merged into this feature): `2026-10-19-sandbox-exit-reason-stderr-substring-defect.md`
    (exit-reason classification `sandbox.py:401-405`, right beside the D-10 parse) and
    `2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md`. Design may choose to absorb the first.
  - Related, unconfirmed: debt-radar NC-A (`InstantiateTemplate` retry idempotency, `servicer.py:684-713` at scan).
- Recommended design depth: full → `/sdd-design fix-indicators-formula-correctness` (rationale: affected services ≥ 2
  — analysis consumes ATR/VWAP — and D-18 may need a proto change). Design forks: D-18 OHLCV contract vs rename;
  D-10 strip `SystemExit`/`KeyboardInterrupt`/`GeneratorExit` from builtins vs treat "no output line" as failure (or both).
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-indicators-formula-correctness

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- Warnings:
  - C9 Open Questions: OQ-1 (Option A vs B for D-18) and OQ-2 (Option B only) are unresolved, and the Fix Scope
    proto checkbox stays unchecked. OQ-1 is a design-gate decision (C-11). /sdd-design must resolve it and settle
    the checkbox before impl-spec.
  - C5 Proto: conditional proto change is correctly flagged. **Resolved in review:** `ComputeIndicatorRequest`
    (`indicators.proto:54-61`) uses fields 1-6 only, so 7+ are free; product-spec Fix Scope now says so.
  - C8 scenario shape: **Resolved in review:** AC-4/AC-5/AC-8/AC-9 and Reproduction step 2 now state the observable
    `ComputeIndicatorResponse.result` (`IndicatorPoint` values; the servicer drops `None` warm-up positions,
    `servicer.py:215-218`) instead of the engine's internal list. AC-1/AC-2 now assert concrete `error` substrings
    ("produced no output", "could not be parsed").
  - C8 mutually exclusive tags: AC-4/AC-5 (@option-A) and AC-8/AC-9 (@option-B) cannot both hold. Design must delete
    the losing pair before the gate/impl-spec, or C-15 coverage of FR-3/FR-4 is ambiguous.
  - C10/11 consumer surface: under Option B, the D-18 backtest/grade behavior change (OQ-2) has no communication or
    recompute plan yet; design must close it.
- Overlap findings (WARN, no FAIL; no config, proto-field or migration collision):
  - `sandbox.py`: 244-fix-python-config-stored-zero (implementation-ready) edits `:282` and `:345-346`, disjoint from
    D-10's `:247-254`. Rebase risk only.
  - `servicer.py`: 244 (config accessor call sites ~`:277-310`) and 269-fix-template-update-metadata (draft; template
    RPCs `:633-635`, `:652`) are disjoint from D-54's `:150-157`, `:490`, `:593`. Rebase risk only; whichever of 244/268
    lands second rebases.
  - No active peer claims `indicators.proto`/`ComputeIndicatorRequest` field numbers. 243 touches watcher/test files
    only.
  - Shared context: 246-fix-fundsignal-neutral-score relies on analysis `_score_via_formula` → `ExecuteFormula`; FR-1
    changes failure semantics, so re-check 246 after 268. 262/272 edit analysis `servicer.py` in regions disjoint from
    268; Option B would touch analysis only at the ATR/VWAP consumer sites. 247/273 touch the agent client (consumer
    surface only, no file overlap).
  - Merge-order: no entry required (no FAIL-level overlap). Lookup caveat: overlap-check A4 greps `feature.md` for
    status, but status now lives only in `status.md`; the scan used `status.md`.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-10, D-18, D-54.
- Next: `/sdd-design fix-indicators-formula-correctness`.

## Session 2026-10-22 — sdd-batch design state recovered (round 1)

- The batch run that produced round 1 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-1 synthesis restored verbatim from the run journal (`synth:fix-indicators-formula-correctness:r1`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 1,
  "synth": {
    "approach": "Round-1 synthesis. The fix stays in xstockstrat-indicators, plus one two-string UI catalog edit. No proto change, no migration, no config change, no analysis change.\n\nSTEP 1 \u2014 D-54 (services/xstockstrat-indicators/app/handlers/servicer.py)\n- In UpdateFormula (:491) and DeleteFormula (:594), widen the existing guard to `if row is None or row.get(\"pending_intent_id\") is not None:`.\n- Reuse the existing NOT_FOUND abort and message unchanged (:492-495, :595-598). This is the same predicate _load_formula uses at :156, and get_by_id runs SELECT * (formulas_repository.py:185), so the column is on the row.\n- Resulting order:\n  - Update: missing or pending \u2192 system author \u2192 owner \u2192 deleted.\n  - Delete: missing or pending \u2192 system author \u2192 owner. Delete has no deleted_at check.\n- Tests use real indicators_pb2 messages and cover every guard branch: missing, pending, system, foreign owner, ADMIN on a foreign row, and deleted (Update only).\n- The pending-row tests assert NOT_FOUND AND that repo.update / repo.delete were never called (AC-6 \"row unchanged\", AC-7 \"no deleted_at\").\n- An ADMIN or non-owner on a pending row gets NOT_FOUND. This is pinned by test and matches no-existence-leak @AC-1@feature-224. @AC-23 and @AC-28 stay PERMISSION_DENIED on non-pending rows.\n\nSTEP 2 \u2014 D-10 (services/xstockstrat-indicators/app/services/sandbox.py)\n- (a) Wrapper (:312): change the marker print to `print(\"\\n__OUTPUT__:\" + ...)`. The marker then always starts its own line, even when the formula ends with print(..., end=\"\"). That case is silently lost today. The cost is one extra newline in stdout.\n- (b) Parse loop (:394-400): keep only the LAST line starting with `__OUTPUT__:` and stop swallowing JSONDecodeError inside the loop.\n- (c) After the existing `if proc.returncode != 0:` block (:402-417), so timeout, memory_exceeded and import_blocked keep their labels:\n  - No marker line seen: fail with error=\"formula produced no output\". Drop the proposal's \"(exited before result was emitted)\" suffix, because the cause is not always an early exit.\n  - Last marker line fails json.loads: fail with error=\"formula output could not be parsed: <msg>\".\n  - Both use exit_reason=\"runtime_error\", which the servicer already maps to SANDBOX_EXIT_REASON_RUNTIME_ERROR (servicer.py:313-319). No new enum value.\n- (d) Add one local closure `_fail(error, exit_reason)` inside execute_formula. It builds `SandboxResult(success=False, output={}, stdout=stdout, stderr=stderr, execution_ms=elapsed_ms, memory_used_bytes=0, error=..., exit_reason=...)` and is used by the existing rc!=0 return and both new returns. It keeps stdout and stderr (C-01: FormulaRunResult.tsx:92-101 renders stdout). Do NOT copy the timeout shape at :381-390, which blanks stdout. No module-level helper.\n- (e) Leave the builtins at :252 as they are.\n- Tests:\n  - AC-1: `raise SystemExit(0)`.\n  - AC-2: print \"__OUTPUT__:{\" then SystemExit(0).\n  - AC-3: `result = {'x': 1}`.\n  - A formula that sets result and ends with print(\"x\", end=\"\"): success, correct output.\n  - os._exit(0): no output.\n  - One servicer-level test asserting exit_reason == SANDBOX_EXIT_REASON_RUNTIME_ERROR, using real pb2 messages.\n\nSTEP 3 \u2014 D-18 Option A (services/xstockstrat-indicators/app/services/indicators_engine.py)\n- Registry text (:141-142):\n  - ATR \u2192 \"ATR (close-to-close approximation): rolling mean of |close change| over period; not Wilder's true range\".\n  - VWAP \u2192 \"VWAP (running mean approximation): cumulative mean of closes; no volume weighting\".\n- Correct the _atr and _vwap docstrings (:104, :112) to describe the math as written.\n- Keys, the dispatch table (:30-31) and the math stay unchanged. ListIndicators reads the registry directly (servicer.py:355-364).\n- In the same step, mirror both strings into services/xstockstrat-ui/src/lib/strategyCatalog.ts:99 and :104 (C-10). Add a vitest under src/lib/** asserting the catalog no longer says 'Average True Range' / 'Volume Weighted Average Price'.\n- Correction to the proposal on the acceptance file: there is no @AC-8/@AC-9 to delete. The ATR and VWAP scenarios are @AC-4 and @AC-5 (acceptance.feature:27-39). Both are written as either/or and are satisfied by their \"Or \u2026 no longer described as \u2026 and names the close-to-close approximation / running mean\" branch. Keep them unchanged, add engine and servicer tests for them, and record OQ-1 = A (OQ-2 moot) in context.md.\n\nSTEP 4 \u2014 Docs\n- indicators CLAUDE.md: the sandbox no-output and unparseable-output failure rule, and the ATR/VWAP approximation note in \u00a7 Role.\n- docs/runbooks/indicator-builder.md:20-21: the same approximation note.\n- Indicators context-constitution findings: record that xstockstrat-trading's ATR(14) (internal/service/trading.go:3168-3235) is true Wilder ATR and differs from the indicators built-in.\n- Add xstockstrat-ui to the product-spec affected services.\n- File docs/reports/<date>-indicators-missing-result-silent-success.md with a .status sidecar for the \"formula never assigns result \u2192 success with {}\" gap (sandbox.py:311).\n\nBuild order: D-54 \u2192 D-10 \u2192 D-18 (engine + UI) \u2192 docs.",
    "open_objections": [
      {
        "text": "C-10 duplicated surface: services/xstockstrat-ui/src/lib/strategyCatalog.ts:99/:104 still claim 'Average True Range' / 'Volume Weighted Average Price'. The synthesis adopts the two-string edit plus a vitest assertion, and adds xstockstrat-ui to the product-spec affected services. The proposer offered this only as a runner-up and has not committed. It stays open until the next proposal confirms the UI edit and the affected-services update, or until an operator waiver with sign-off is recorded (a context.md note alone is not a C-14 deferral).",
        "blocking": true
      },
      {
        "text": "D-10 marker framing: a legitimate formula ending in print(..., end='') produces 'x__OUTPUT__:{...}', which would now be misreported as no output. The synthesis resolves this with a leading '\\n' in the wrapper print (sandbox.py:312) and drops the '(exited before result was emitted)' suffix. The proposer must confirm both changes and the end='' test.",
        "blocking": false
      },
      {
        "text": "C-08/P-06 (ledger fails.md:76-77): the D-54 tests must cover every guard branch (missing, pending, system, foreign owner, ADMIN on foreign, deleted for Update only). The pending tests must assert that repo.update/repo.delete were not called. A pending system-authored row and a pending foreign row seen by ADMIN must also be tested, to pin the order of the merged guard. The proposal's order statement must be corrected for DeleteFormula, which has no deleted_at step.",
        "blocking": false
      },
      {
        "text": "C-01: every new failure return must keep stdout and stderr, through a single local _fail closure (C-18) rather than three copies of the SandboxResult literal. The timeout shape at sandbox.py:381-390, which blanks stdout, must not be copied. The spec step must say this explicitly.",
        "blocking": false
      },
      {
        "text": "P-03: the 'formula never assigns result' gap (sandbox.py:311, success with {}) must be filed as a defect report with a .status sidecar under docs/reports/, not left as a context.md note.",
        "blocking": false
      },
      {
        "text": "Acceptance-file handling: the proposal says to delete @AC-8/@AC-9, which do not exist. The ATR/VWAP scenarios are @AC-4/@AC-5, are written as either/or, and are satisfied by Option A. The next proposal must keep them and test them, not delete them.",
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
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-7",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-1@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-6@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-18@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-19@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-23@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-28@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3@feature-209",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4@feature-209",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1@feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-10@feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-11@feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5@feature-205",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-7@feature-205",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "D-18 Option B (true Wilder ATR/VWAP from OHLCV): it needs the proto gate, OHLCV plumbing at 4 analysis sites (evaluator.py:496, screener.py:294/:360, pnl_pattern_consumer.py:98), a warm-up recheck (warmup.py:86), and it invalidates stored grades and pnl_pattern_samples (OQ-2). That is high rework, against the user's 'low rework' directive.",
      "Renaming the keys (e.g. CLOSE_ATR): it breaks FR-3/FR-4 key stability and every stored strategy definition and fingerprint.",
      "Stripping SystemExit/KeyboardInterrupt/GeneratorExit from the restricted builtins (sandbox.py:252): it yields a NameError with rc=1 instead of AC-1's 'produced no output', misses os._exit(0) and attribute-traversal exits, and adds nothing once the parent-side check exists.",
      "Wrapper-only fix (catch SystemExit around exec and print a sentinel): it does not cover os._exit or traversal exits. The parent-side check is the only complete seam.",
      "Keeping 'last parseable line' plus a saw_output flag: AC-2 would pass only when no valid line exists at all. 'Last marker line, strict' is deterministic.",
      "Running the no-output check before the returncode!=0 branch: it would relabel timeout, memory_exceeded and import_blocked failures (@feature-228, @feature-209).",
      "Adding a new SandboxExitReason enum value: a proto churn with no need. RUNTIME_ERROR=4 and the declared-outputs precedent (servicer.py:336) already cover it.",
      "Deleting @AC-4/@AC-5 (the proposal's '@AC-8/@AC-9'): they are written as either/or and are satisfied by Option A, so deleting them loses regression coverage for no gain.",
      "Recording the UI catalog drift only in context.md: it is not a C-14 deferral (no named follow-up feature), and the fix is two strings.",
      "Error suffix '(exited before result was emitted)': it states the wrong cause for marker-framing cases. Use the neutral 'formula produced no output', which still meets AC-1."
    ],
    "open_risks": [
      "Consumers that showed an empty-success run as 'Passed' (/insights workspace, agent test_formula) will now show Failed with runtime_error. The adversary verified this renders correctly (FormulaRunResult.tsx:70-77, agent client.py:1022-1027, screener.py:353-354 returns None, evaluator.py:133 raises). Strategies whose formulas were silently empty will now stop scoring instead of scoring on empty series. This is intended, but visible to users.",
      "The leading '\\n' before the marker adds one line to stdout. Any test or consumer that asserts exact stdout equality could break. Existing tests in tests/test_sandbox.py and test_sandbox_isolation.py must be re-run; the _fake_popen default stdout '__OUTPUT__:{}' still parses.",
      "A formula can still forge success by printing a valid marker line and then calling SystemExit(0). This is accepted: it is the author's own output and not an isolation breach.",
      "After Option A, 'ATR' means two different numbers on the platform: indicators uses a close-to-close approximation, trading uses true Wilder ATR(14) for position sizing (trading.go:3168-3235). This is mitigated only by documentation.",
      "Rebase conflict with feature 244, which edits other regions of sandbox.py, and with any peer feature touching servicer.py.",
      "The 'never assigns result' gap remains a silent success until the new defect report is triaged."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-08",
      "C-10",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-06",
      "F-07"
    ],
    "rationale": "The proposal and the adversary agree on the core design: a parent-side D-10 check placed after the returncode branch, a merged pending guard for D-54, and Option A for D-18. That design has no Floor breaches and is the lowest-rework path, which is what the user asked for. Option A is enough because @AC-4/@AC-5 in acceptance.feature:27-39 are written as either/or and Option A meets their 'Or' branch. The proposal's plan to delete the non-existent @AC-8/@AC-9 is corrected to keeping and testing them, which preserves more coverage. The adversary's fixes are folded in: the leading-newline marker (it rescues legitimate end='' formulas instead of misreporting them), a neutral error text that still meets AC-1, the _fail closure that keeps stdout (C-01/C-18), per-branch D-54 tests with not-called assertions (ledger 063 trap), a filed defect report for the missing-result gap (P-03), and doc notes on the trading-ATR divergence. C-10 for the UI catalog is the only blocking item. The synthesis adopts the two-string fix, but the proposer has not yet committed to it or to the affected-services update. C-03 is not touched, since there are no new outbound calls."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 2)

- The `/sdd-design fix-indicators-formula-correctness` full debate is halted at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged. The next /sdd-batch run resumes from the state block below.
- (/sdd-spec 2026-10-22) The Step 2 D-54 tests reuse the module-local `_row`/`_servicer` in
  `tests/test_private_formulas.py` (single consumer, C-13 lazy rule). No conftest builder is added.
- (/sdd-spec 2026-10-22) Step 3 writes the wrapper marker as `"\\n__OUTPUT__:"` in source, because the
  template is a non-raw `.format` string.

## Open Threads

- **Approach (round 2):** The proposer has committed to the UI catalog edit (strategyCatalog.ts:99/:104 + vitest) and to adding xstockstrat-ui to the affected services. That closes the round-1 blocking C-10 objection.
  - Scope is xstockstrat-indicators plus two UI strings. There is no proto, migration, config or analysis change, so `packages/proto` and `xstockstrat-analysis` become "consumer, unchanged".
  - Build order:
    1. D-54: widen the pending-row NOT_FOUND guard in UpdateFormula/DeleteFormula, with a conftest row builder (C-13).
    2. D-10: add parent-side no-output and unparseable-output checks after the rc≠0 branch, a single `_fail` closure, and a non-empty rc≠0 error fallback.
    3. D-18 Option A: approximation descriptions in the engine and in the UI catalog.
    4. Docs, plus a new defect report for the "never assigns result" gap.
- **Strongest open objection (non-blocking):** an early non-zero exit with empty stderr (`raise SystemExit(1)`) returns an empty error (sandbox.py:402-417).
  - It was downgraded because the adversary cited an "FR-1" that the committed product-spec.md does not contain, and no @AC requires a non-empty rc≠0 error.
  - The synthesis still folds in a one-expression fallback, `stderr.strip()[-500:] or f"formula exited with code {rc} before producing output"`, plus a SystemExit(1) test.
  - The proposer must confirm this, or argue it out of scope.
- **Other non-blocking items the proposer must confirm:**
  - C-15: add FR-1..FR-3 and @FR tags (append-only; no @AC IDs change).
  - C-13: a conftest row builder.
  - Record the marker-framing choice (a leading `\n` by default, or rfind).
  - C-01: re-cite the stdout renderers (FormulaRunResult.tsx:92-98, tools.py:1486) as the justification.
  - Close the feature-246 deferral using the verified fail-closed consumers.
  - Record the duplicated catalog text as accepted debt, with the follow-up "source from ListIndicators".
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes:** none.
  - The operator-scoped decision covers every CHANGE (AC-1, AC-2, AC-4, AC-5, AC-6, AC-7) and the EXTEND of AC-1@feature-224.
  - All other affected-service ACs (@feature-224, @feature-228, @feature-209, @feature-225, @feature-205) are PRESERVE.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. The proposer has now committed to the UI catalog edit and to adding xstockstrat-ui to the affected services, which closes the round-1 blocking C-10 objection. The fix stays in xstockstrat-indicators plus two strings in xstockstrat-ui. No proto, migration, config or analysis change, so `packages/proto` and `xstockstrat-analysis` drop to \"consumer, unchanged\" in the product-spec.\n\nSTEP 1 — D-54 (services/xstockstrat-indicators/app/handlers/servicer.py)\n- In UpdateFormula (:491) and DeleteFormula (:594), widen the guard to `if row is None or row.get(\"pending_intent_id\") is not None:`.\n- Reuse the existing NOT_FOUND abort and message unchanged (:492-495, :595-598). This is the same predicate `_load_formula` uses at :156.\n- Resulting order:\n  - Update: missing or pending → SYSTEM_AUTHOR (:496) → owner (:502) → deleted_at (:508).\n  - Delete: missing or pending → SYSTEM_AUTHOR (:599) → owner (:605). Delete has no deleted_at step.\n- Tests use real indicators_pb2 messages, one per guard branch:\n  - missing, pending, system, foreign owner, ADMIN on a foreign row, and deleted (Update only);\n  - a pending row authored by SYSTEM_AUTHOR → NOT_FOUND (pins that the pending check runs first);\n  - a pending foreign row called by ADMIN → NOT_FOUND.\n- Every pending-row test asserts repo.update / repo.delete was never awaited (AC-6, AC-7).\n- Non-pending rows keep @AC-23 and @AC-28@feature-224 (PERMISSION_DENIED).\n- NEW (C-13): put the formula-row builder (pending, system-pending, foreign, deleted variants) in services/xstockstrat-indicators/tests/conftest.py, or reuse an existing row fixture there if one exists. No inline dict copies.\n\nSTEP 2 — D-10 (services/xstockstrat-indicators/app/services/sandbox.py)\n- (a) Marker framing. Default: the wrapper (:312) prints \"\\n__OUTPUT__:\" + json.dumps(...), so the marker always starts its own line, even when the formula ends with `print(..., end='')`. Keep `startswith` on its own line, which cannot match marker text inside a user's printed line.\n  - Cost: one blank line before the marker in raw stdout shown by FormulaRunResult.tsx:98 and agent test_formula. No test pins stdout equality (test_sandbox_isolation.py:256 is a \"not in\" check).\n  - Alternative: parent-side `rfind`. The proposer must record which one is chosen and confirm that `_fake_popen`'s default \"__OUTPUT__:{}\" (test_sandbox_isolation.py:60) still parses under it. It does under the default.\n- (b) Parse loop (:394-400): keep only the raw text of the LAST line starting with `__OUTPUT__:`. Stop swallowing JSONDecodeError inside the loop.\n- (c) Add one local closure `_fail(error, exit_reason)` inside execute_formula. It returns `SandboxResult(success=False, output={}, stdout=stdout, stderr=stderr, execution_ms=elapsed_ms, memory_used_bytes=0, error=error, exit_reason=exit_reason)`.\n  - The rc≠0 return (:408-417) uses it, and the stderr classification (:403-407) is unchanged.\n  - NEW (adopted from the adversary): the rc≠0 error becomes `stderr.strip()[-500:] or f\"formula exited with code {proc.returncode} before producing output\"`, so `raise SystemExit(1)`/`SystemExit(2)` (empty stderr) no longer return an empty error. exit_reason stays classified (runtime_error).\n  - The timeout branch (:378-390) is untouched and not copied.\n- (d) Only when returncode == 0:\n  - no marker line → `_fail(\"formula produced no output\", \"runtime_error\")`;\n  - json.loads fails on the last marker line → `_fail(f\"formula output could not be parsed: {e}\", \"runtime_error\")`;\n  - otherwise the existing success return (:419-428).\n- (e) Builtins at :252 unchanged.\n- Tests (tests/test_sandbox.py):\n  - AC-1 `raise SystemExit(0)`;\n  - AC-2 print \"__OUTPUT__:{\" then SystemExit(0);\n  - AC-3 `result = {'x': 1}`;\n  - result set, then `print(\"x\", end=\"\")` → success with the correct output;\n  - `os._exit(0)` → no output;\n  - NEW `raise SystemExit(1)` → success=false with a non-empty error;\n  - re-run the @feature-228 matrix and the @feature-209 kill tests as-is;\n  - one servicer-level test with real pb2 messages asserting exit_reason == SANDBOX_EXIT_REASON_RUNTIME_ERROR through servicer.py:313-319.\n- Error strings match acceptance.feature:10 (\"produced no output\") and :18 (\"could not be parsed\").\n\nSTEP 3 — D-18 Option A\n- indicators_engine.py:141-142 descriptions:\n  - ATR → \"ATR (close-to-close approximation): rolling mean of |close change| over period; not Wilder's true range\"\n  - VWAP → \"VWAP (running mean approximation): cumulative mean of closes; no volume weighting\"\n- Correct the _atr/_vwap docstrings (:103-116). Keys, dispatch (:30-31) and math are unchanged.\n- Mirror both strings into services/xstockstrat-ui/src/lib/strategyCatalog.ts:99 and :104.\n- Add src/lib/strategyCatalog.test.ts (vitest), scoped to asserting that no 'Average True Range'/'Volume Weighted Average Price' text remains.\n- Record the two-place duplication (engine + catalog) as accepted debt in context.md, with a named follow-up: source the catalog from ListIndicators (servicer.py:355-364).\n- Add xstockstrat-ui to the product-spec affected services.\n- Keep @AC-4/@AC-5 (acceptance.feature:27-39). Their \"Or\" branch is met. Cover them with engine and servicer tests: ListIndicators text, and ComputeIndicator values unchanged ([1.5, 1.5]; [10, 15, 20]).\n- Record OQ-1 = A in context.md; OQ-2 is moot.\n\nSTEP 4 — Docs and defect filing\n- Indicators CLAUDE.md: add the sandbox no-output / unparseable / empty-stderr failure rule, and the ATR/VWAP approximation note under § Role.\n- docs/runbooks/indicator-builder.md: the same approximation note.\n- Indicators docs/context-constitution-findings.md: record that trading's ATR(14) (trading.go:3168-3235) is true Wilder ATR and differs from the indicators built-in.\n- File docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md with a .status sidecar set to `open`, for the \"never assigns result → success with {}\" gap at sandbox.py:311.\n- NEW: write the verified consumer fail-closed paths into design.md/context.md and drop the open \"re-check feature 246\" item:\n  - fundamentals_scoring.py:61-63 raises FundamentalsScoringError, which fundsignal_loop.py:465 turns into a per-symbol skip;\n  - screener.py:353-354 returns None;\n  - evaluator.py:133 raises FormulaExecutionError.\n- C-15 tagging: product-spec.md has no FR-N list today (verified: no \"FR-\" match). /sdd-design adds FR-1..FR-3 (D-10, D-18, D-54) to the product-spec and appends the matching @FR-N tags to AC-1..7. This is append-only and changes no @AC IDs, so it is not a C-16 CHANGE.\n\nBuild order: D-54 → D-10 → D-18 (engine + UI) → docs. No new outbound calls, so C-03 trace propagation is not touched.",
    "open_objections": [
      {
        "text": "Early non-zero exit with empty stderr (raise SystemExit(1)/(2)) returns success=false with error=\"\" (sandbox.py:402-417). The adversary grounded this in an 'FR-1' text, but the committed product-spec.md has no FR list and no AC requires a non-empty error for rc≠0. It is therefore not blocking. The synthesis still adopts the one-expression fallback inside the rc≠0 `_fail` call it already touches (`stderr.strip()[-500:] or f\"formula exited with code {rc} before producing output\"`), keeping the classified exit_reason, plus a SystemExit(1) test. The proposer must confirm it, or argue it out of scope under the product-spec's 'Out of Scope' stderr-classification exclusion.",
        "blocking": false
      },
      {
        "text": "C-15: acceptance.feature AC-1..7 carry no @FR-N tags, and product-spec.md defines no FR-N (verified). The spec step must add FR-1..FR-3 (D-10/D-18/D-54) to product-spec.md and append @FR tags to every scenario. This is append-only and changes no @AC IDs.",
        "blocking": false
      },
      {
        "text": "C-13: the D-54 guard tests repeat the same formula-row shapes (pending, system-pending, foreign, deleted). Put one row builder in tests/conftest.py, or reuse an existing fixture there, instead of inline dicts.",
        "blocking": false
      },
      {
        "text": "Marker-framing choice must be recorded: a leading '\\n' in the wrapper (the default, which changes visible stdout by one blank line) vs parent-side rfind (no stdout change, but it can match a marker inside user text). In either case, confirm that the _fake_popen default \"__OUTPUT__:{}\" (test_sandbox_isolation.py:60) still parses.",
        "blocking": false
      },
      {
        "text": "C-01 is miscited as a 'stdout preservation' rule. Re-justify keeping stdout/stderr in `_fail` with FormulaRunResult.tsx:92-98 and the agent test_formula rendering (tools.py:1486). Keep C-18 (a single construction) as the duplication rationale.",
        "blocking": false
      },
      {
        "text": "Close the vague 're-check feature 246 after landing' deferral (P-03). Write the verified fail-closed consumers into design.md/context.md: fundamentals_scoring.py:61-63 → fundsignal_loop.py:465 skip, screener.py:353-354 None, evaluator.py:133 raise.",
        "blocking": false
      },
      {
        "text": "The ATR/VWAP descriptions now live in two places (indicators_engine.py:141-142, strategyCatalog.ts:99/:104). Record this as accepted debt with a named follow-up (source the catalog from ListIndicators, servicer.py:355-364), and scope the vitest to 'no Average True Range / Volume Weighted Average Price text remains'.",
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
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-7",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-1@feature-224",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-6@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-18@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-19@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-23@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-28@feature-224",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5@feature-228",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3@feature-209",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4@feature-209",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-1@feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-10@feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-11@feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5@feature-205",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-7@feature-205",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "D-18 Option B (true Wilder ATR/VWAP from OHLCV): it needs the proto gate, plumbing at 4 analysis sites (evaluator.py:496, screener.py:294/:360, pnl_pattern_consumer.py:98) and a warm-up recheck, and it invalidates stored grades (OQ-2). That is too much rework for a SEV-2 fix.",
      "Renaming the keys (e.g. CLOSE_ATR): it breaks key stability and every stored strategy definition and fingerprint.",
      "Stripping SystemExit/KeyboardInterrupt/GeneratorExit from the builtins (sandbox.py:252): it misses os._exit(0) and traversal exits, and it turns AC-1 into a NameError instead of 'produced no output'. Parent-side detection is the right layer.",
      "Wrapper-only SystemExit catch plus a sentinel: it does not cover os._exit or traversal exits.",
      "Keeping 'last parseable line' plus a saw_output flag: it is non-deterministic for AC-2. 'Last marker line, strict' wins.",
      "Running the no-output check before the rc≠0 branch: it would relabel timeout, memory_exceeded and import_blocked (@feature-228, @feature-209).",
      "Adding a new SandboxExitReason enum value: unnecessary proto churn. RUNTIME_ERROR=4 and the declared-outputs precedent (servicer.py:336) suffice.",
      "Adding `AND pending_intent_id IS NULL` to the repo UPDATE/DELETE SQL: a row only moves pending → visible (formulas_repository.py:141-147), so there is no mutation race, and an ambiguous None return would need remapping. The servicer guard is sufficient.",
      "A per-run nonce in the output marker: spoofing gains no privilege, since the author already controls result, and traceback frame traversal could read the nonce anyway.",
      "Deleting @AC-4/@AC-5 (the proposal's earlier '@AC-8/@AC-9'): they are either/or scenarios satisfied by Option A, so deleting them only loses coverage.",
      "Recording the UI catalog drift only in context.md: it is not a C-14 deferral, and the fix is two strings.",
      "Error suffix '(exited before result was emitted)': it states the wrong cause in marker-framing cases. The neutral 'formula produced no output' still meets AC-1."
    ],
    "open_risks": [
      "D-10 is a visible behavior change. Formulas that silently produced nothing now fail with RUNTIME_ERROR. The /insights workspace and agent test_formula show Failed, and strategies relying on empty output stop scoring. The consumer paths are verified fail-closed: screener.py:353-354, evaluator.py:133, fundamentals_scoring.py:61-63 → fundsignal_loop.py:465.",
      "With the leading '\\n' framing, raw stdout gains one blank line before the marker. No test pins exact stdout today, but external consumers diffing stdout could notice.",
      "A formula can still forge success by printing a valid marker line and then calling SystemExit(0). This is accepted: it is the author's own output and not an isolation breach.",
      "After Option A, 'ATR' means two different numbers on the platform (indicators close-to-close approximation vs trading's Wilder ATR(14), trading.go:3168-3235). This is mitigated by documentation only.",
      "ATR/VWAP description text is duplicated between indicators_engine.py and strategyCatalog.ts and can drift again until the catalog is sourced from ListIndicators.",
      "Assumption not re-verified this round: the saga commit/abort paths never go through UpdateFormula/DeleteFormula (@AC-19@feature-224). The spec step should grep to confirm it.",
      "Rebase conflicts with feature 244 (sandbox.py) and with peer batch features touching servicer.py.",
      "The 'never assigns result' gap remains a silent success until the new defect report is triaged."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-06",
      "F-07"
    ],
    "rationale": "The round-1 blocking C-10 objection is closed: the proposer committed to the strategyCatalog.ts two-string edit, the vitest and the affected-services update. The adversary's one blocking objection (an empty error on SystemExit(1)) cites an 'FR-1' that does not exist in the committed product-spec.md, where grep finds no FR-N, and no @AC requires a non-empty rc≠0 error. It is therefore downgraded to non-blocking. Its cheap fix (an `or` fallback inside the rc≠0 `_fail` call the step already rewrites, plus a test) is folded into the approach because it costs one expression and lies in D-10's own seam. The remaining items are hygiene fixes the synthesis has already written into the approach:\\n- C-13 conftest row builder;\\n- the recorded marker-framing choice;\\n- C-01 re-citation to the UI/agent stdout renderers;\\n- closing the feature-246 deferral with verified fail-closed citations;\\n- recording the catalog duplication as accepted debt;\\n- adding FR-1..3 plus @FR tags for C-15.\\n\\nThere are no Floor breaches and no unsanctioned business-rule CHANGEs. AC-1@feature-224 is an EXTEND, because pending rows now also get NOT_FOUND on mutation. That is within the operator-scoped D-54. C-03 is untouched because no outbound calls are added. Nothing blocks approval once the proposer confirms the adopted items."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md was written earlier. It covers:
  - xstockstrat-indicators: the fix site.
  - xstockstrat-analysis: a consumer.
  - packages/proto: affected only under Option B.
- Key reuse patterns:
  - the `_load_formula` pending-hidden predicate (`servicer.py:156`) plus the existing NOT_FOUND abort;
  - the `SandboxResult(success=False, ...)` construction (`sandbox.py:408-417`) and the `runtime_error` → `SANDBOX_EXIT_REASON_RUNTIME_ERROR` map.
- Phase 1 Grilling: 2 rounds (full mode), approved at the operator gate.
- Chosen approach, built in this order:
  1. D-54: an inline pending guard in UpdateFormula/DeleteFormula.
  2. D-10: parent-side failure on rc==0 when the output is missing or unparseable. It uses a single `_fail` closure and leading-`\n` marker framing, and an rc≠0 failure always gets a non-empty error.
  3. D-18: Option A descriptions in the engine and in `strategyCatalog.ts`.
  4. Docs, plus a new defect report.
- Rejected: Option B (OHLCV plus proto), a key rename, builtins stripping, `rfind` framing, a new enum value, a repo-SQL guard, and a marker nonce.
- Constitution rules touched: C-01, C-03 (untouched), C-08, C-10, C-11, C-13, C-14, C-15, C-16, C-18, P-02, P-03, P-06, F-01, F-06, F-07. Floor breaches: none.
- Status: spec-ready → design-approved.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Features are grouped by service and theme from the 2026-10-20 debt-radar scan, and routed via Track C (precedent #1264).
  - Scope is D-10, D-18 and D-54.
  - Operator 2026-10-21 (standing, all features): propagate x-trace-id as much as possible, with no C-03 waiver.
    - Request-derived emits and writes use `context.WithoutCancel(ctx)` (Go) or the inbound metadata (Python/Node), never a fresh background context.
    - Only work with no originating request (background sweepers and loops) may mint its own context. It should still carry a trace id when one is available.
  - Operator 2026-10-22 (design gate r2): APPROVED as synthesized.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 10 steps. Status: design-approved → implementation-ready.
- The steps follow the design's build order: D-54, then D-10, then D-18 (engine, then UI), then docs.
- Each service step is paired with its test step: 1/2 (D-54), 3/4 (D-10), 5/6 (D-18 engine),
  7/8 (UI catalog plus vitest). Steps 9-10 are docs.
- Scenario coverage:
  - AC-6/AC-7 → Step 2;
  - AC-1/AC-2/AC-3 → Step 4;
  - AC-4/AC-5 → Step 6, plus Step 8 for the UI text.
- Key codebase findings (re-verified on `origin/feature/fix-indicators-formula-correctness`):
  - The design's line numbers still hold:
    - `servicer.py:490`/`:491` and `:593`/`:594` (the raw `get_by_id` / `if row is None:`);
    - `sandbox.py:310-312`, `:394-400`, `:402-428`;
    - `indicators_engine.py:141-142`;
    - `strategyCatalog.ts:99`, `:104`.
  - **Wrapper escape trap.** `_SANDBOX_WRAPPER` (`sandbox.py:206`) is a non-raw `textwrap.dedent("""...""")`
    filled by `.format`. The leading-newline marker therefore has to be written as `"\\n__OUTPUT__:"` in
    source; a single `\n` would produce a SyntaxError in every formula. This is recorded in Step 3.
  - **Saga re-verification (Open Thread closed).** The saga does not go through UpdateFormula/DeleteFormula.
    - Commit and abort run through `FormulasRepository.resolve_intent` (`formulas_repository.py:137-150`),
      which is called only at `servicer.py:738`.
    - Copies are created by `create_pending_copies`, called only at `:711`.
  - The trading Wilder ATR is at `trading.go:3170-3198`, called at `:3233`. design.md cited `:3168-3235`,
    so the spec uses the exact range.
  - The `os._exit` traversal path already exists in `tests/test_sandbox_isolation.py:434`
    (`numpy.lib._datasource.os`). Step 4 reuses it.
  - `ListIndicators` and servicer `ComputeIndicator` have no existing tests, so Step 6 adds the first ones.
  - The agent surfaces pass the change through, so no agent code changes:
    - `test_formula` returns the full sandbox result (`tools.py:1488-1495`);
    - NOT_FOUND is mapped at `tools.py:232`.
- **C-13 reconciliation (Step 2).** design.md asked for one row builder in `tests/conftest.py`, "or an existing
  row fixture". The existing builder is `_row(formula_id, author, pending_intent_id=None, ...)` at
  `tests/test_private_formulas.py:29`, and that file is its only consumer. Under C-13's lazy rule it stays
  module-local, and the new tests live in that file. Adding a conftest builder would be speculative.
- **Product-spec housekeeping is done.**
  - Affected Services: added xstockstrat-ui; analysis and proto are marked "consumer, unchanged".
  - Fix Scope: the proto checkbox is settled as "No proto change (Option A)".
- The merge-order entry for 244/269 is outside this session's write scope (feature-dir files only). It is
  deferred to the `/sdd-execute` integration PR, as noted in the spec's Step Dependencies.
- Verification commands run pytest through the service venv (`.venv/bin/python -m pytest`), per
  fails.md 2026-09-28 (subprocess `sys.executable`).

## Decisions

- **OQ-1 = Option A.** Re-describe ATR/VWAP and keep the keys and math unchanged. OQ-2 is moot, and there is no proto change.
- The losing `@option-B` scenarios, `@AC-8`/`@AC-9`, were deleted from acceptance.feature and the header was updated. AC-1..AC-7 are kept.
- `xstockstrat-ui` joins the affected services: `strategyCatalog.ts:99`/`:104` plus a vitest. Analysis and proto become "consumer, unchanged".
- Marker framing: the wrapper prints a leading `\n` before `__OUTPUT__:`. The parent checks each line with `startswith`, keeps the last marker line, and parses it strictly.
- An rc≠0 run with empty stderr gets the error `formula exited with code {rc} before producing output`. This is required, not optional, because product-spec FR-1 requires a non-empty `error`.
- **Correction to the round-2 synthesis.** The synthesis said product-spec.md has no FR-N list. It does: FR-1..FR-5 exist, and AC-1..AC-7 already carry `@FR-N` tags. No FR or tag addition is needed.
- The consumers of `success=false` were verified to fail closed, which closes the "re-check feature 246" item:
  - `fundamentals_scoring.py:61-63` raises `FundamentalsScoringError`, and `fundsignal_loop.py:465` turns it into a per-symbol skip;
  - `screener.py:353-354` returns `None`;
  - `evaluator.py:133` raises `FormulaExecutionError`.
- **Accepted debt:** the ATR/VWAP description text is duplicated in `indicators_engine.py:141-142` and `strategyCatalog.ts:99`/`:104`. Named follow-up: source the UI catalog from `ListIndicators` (`servicer.py:355-364`).

## Open Threads

- [ ] D-10 is a visible behavior change: formulas that produced no output now fail with RUNTIME_ERROR.
  - Target: the D-10 step (an indicators CLAUDE.md note and the PR body).
- [ ] Raw stdout gains one blank line before the marker.
  - Target: the D-10 step (the PR body).
- [ ] A formula can still forge success with a valid marker line followed by `SystemExit(0)`. This is accepted.
  - Target: the D-10 step (a CLAUDE.md note).
- [ ] "ATR" now means two different numbers: the indicators approximation and trading's Wilder ATR(14) (`trading.go:3168-3235`).
  - Target: the docs step (the indicators findings doc).
- [ ] The duplicated ATR/VWAP description text can drift.
  - Target: a post-launch follow-up (source the catalog from ListIndicators).
- [x] Re-verify by grep that the saga commit/abort never goes through UpdateFormula/DeleteFormula (`@AC-19@feature-224`).
  - Closed at /sdd-spec 2026-10-22: the saga uses `resolve_intent` (`servicer.py:738`) and `create_pending_copies` (`:711`) only.
- [ ] Expect rebase conflicts with 244 (`sandbox.py`) and with batch peers editing `servicer.py` (e.g. 269).
  - Target: the merge-order entry at the `/sdd-execute` integration PR (outside the /sdd-spec write scope), and execute.
- [ ] The "never assigns result" gap stays a silent success.
  - Target: the docs step (file `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md` with an `open` sidecar), then `/sdd-triage`.
- [x] Product-spec housekeeping.
  - Done at /sdd-spec 2026-10-22.
  - Affected Services: add xstockstrat-ui, and mark analysis and proto as unchanged consumers.
  - Fix Scope: settle the proto checkbox as "no proto change (Option A)".

## Session 2026-10-22 — sdd-review impl-spec

- Mode B (advisory). Lifecycle unchanged (`implementation-ready`). Criteria verdict: PASS WITH WARNINGS, no
  FAIL, no floor breach. Overlap verdict: WARN (shared-file rebase risk only; no proto, migration or config
  collision).
- **Addressed in implementation-spec.md:**
  - Step 8: verification now runs `pnpm run test:coverage`, and the spec states the threshold. It is the
    40% floor on `src/lib/**`, enforced by `vitest.config.ts:29-33` (re-verified).
  - Steps 7/8: added a note that no Playwright step is needed. The change is static catalog text covered by
    vitest, and no `e2e/` spec references the old strings (re-verified by grep).
  - Step 3: the `_fail` grep now expects 4 lines (the def line also matches `_fail(`, plus 3 call sites).
  - Step 3: the `"\\n__OUTPUT__:"` escape is flagged as the highest-risk edit. Run Step 4's suite right after it.
  - Step 5: the `screener.py` citation now gives both lines: `:285` is the `_latest_indicator("ATR", ...)` call
    and `:279-284` is its comment (re-verified). The product-spec's `:279-284` and the spec's `:285` agree.
- **Still open (surface at the /sdd-execute checkpoint):**
  - C-18 accepted debt: the duplicated ATR/VWAP text has a named follow-up, but the follow-up is not filed
    anywhere durable yet. This review's write scope is the feature dir only.
  - merge-order.md: no rows exist for 268 vs 244 (`sandbox.py`, `servicer.py`) or 268 vs 269 (`servicer.py`).
    Add soft rows (rebase-only, Resolved=No) at the integration PR.
  - 269-fix-template-update-metadata has no implementation-spec yet, so its `servicer.py` overlap is
    unverified. Re-scan when 269 reaches implementation-ready.

## Open Threads (sdd-review impl-spec 2026-10-22)

- [ ] File the C-18 follow-up (source the UI strategy catalog from `ListIndicators`, `servicer.py:354-363`) as a
  durable item: a defect report or a feature idea.
  - Target: /sdd-execute (Step 10, alongside the missing-result report) or post-launch.
- [ ] Add soft merge-order.md rows for 268 vs 244 and 268 vs 269.
  - Target: the /sdd-execute integration PR.
- [ ] Re-scan the `servicer.py` overlap with 269 once its implementation-spec exists.
  - Target: the /sdd-execute checkpoint before Step 1.

## Session 2026-10-28 — re-spec (sdd-batch-execute)

- Branch setup: merged `origin/main-dev` into `feature/fix-indicators-formula-correctness` with `-X ours`
  (merge commit 8c38a675).
- Re-spec of steps 2, 3, 7, 10 against the merged codebase. Line drift only, no file or symbol missing:
  - Step 2: `SYSTEM_AUTHOR` import `test_private_formulas.py:9` → `:10`; `_admin` `:63-67` → `:62-66`;
    `ctx.abort` side effect `conftest.py:33` → `:32`. All other citations re-verified.
  - Step 3: the wrapper output block is `sandbox.py:310-312` with `:310` the comment and the code on
    `:311-312`. All other citations re-verified.
  - Step 7: the `strategyCatalog` consumer list now includes `src/lib/screenPresets.test.ts`. It reads only
    `.name` (`:7`) and asserts no description, so "no consumer needs a change" holds.
  - Step 10: the `_output = _formula_globals.get('result', {{}})` citation `sandbox.py:310` → `:311`.
