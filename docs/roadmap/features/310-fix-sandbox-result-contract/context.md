# Context Log: fix-sandbox-result-contract

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md` — sandbox exit reason classified by stderr substring match (SEV-3)
  - `docs/reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md` — SandboxResult.memory_used_bytes always zero (SEV-3)
  - `docs/reports/2026-10-22-indicators-missing-result-silent-success-defect.md` — formula that never assigns result returns success with empty output (SEV-2)
- Cluster rationale: all three are the sandbox child-wrapper → parent result contract in `app/services/sandbox.py`; a structural child report fixes classification, measurement and missing-result together.
- Severity: SEV-2 (highest of the cluster)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-indicators (consumer surfaces: xstockstrat-ui formula test, xstockstrat-agent test_formula)
- Root cause hypothesis: forgeable stderr substrings; memory accounting never implemented; `.get('result', {})` default
- Recommended design depth: full → `/sdd-design fix-sandbox-result-contract` (rationale: SEV-2 plus a live proto-deprecation option for memory_used_bytes and a formula-contract decision (Open Question 1); consumer surfaces read the result)
- Development branch: feature/fix-sandbox-result-contract

## Session 2026-11-10 (/sdd-review product-spec — operator decisions)

- First review FAILed criterion 8: AC-2/AC-3 had either/or Thens hinging on OQ1/OQ2.
- Operator decided: missing `result` → `success=false` with an error naming `result`; explicit
  `result = {}` still succeeds; `memory_used_bytes` is measured (no proto change).
- AC-2/AC-3 rewritten to single outcomes; AC-4 added for the explicit-empty-result case.

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); re-reviewed after operator decisions (missing result fails; memory measured); OQ3 structural exit-reason signal deferred to design; first review FAILed crit 8
- Overlap findings: WARN: indicators.proto file shared with 322 (different messages); indicators shared with 309/327
- Recommended design depth: full (indicators + ui/agent consumers; contract change)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

## Open Threads

- **Gate**: `/sdd-design fix-sandbox-result-contract` full debate is halted at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged. The register is in `debate.md` (D-1..D-11, R-1..R-9, O-1..O-10).
- **Approach**: a per-run nonce status line (`secrets.token_hex(16)`) on the child's stdout. The wrapper's `_ImportBlocked` / `MemoryError` / `BaseException` handler chain emits it around exec and json.dumps, followed by a bare re-raise (D-1, D-6). Missing `result` is detected by key presence (`no_result`, giving runtime_error "formula did not assign result"; `result = {}` still succeeds) (D-3). `_split_status` strips the status line plus its injected newline, so stdout is byte-identical to what the formula printed (D-5, D-11). The returncode != 0 classifier order is: status import_blocked/memory_exceeded, then -SIGKILL + `_oom_kill_rose`, then any other status → runtime_error, then the no-status `_MEMORY_EXHAUSTED_MARKERS` fallback, then runtime_error (D-7). The "is not allowed in sandbox" substring test is deleted (D-2). `memory_used_bytes` is the leader's VmHWM, read through a pre-seccomp `/proc/self/status` fd, and is 0 ("not measured") on paths with no status line. There is no VmRSS fallback (D-10). All code changes are in `services/xstockstrat-indicators/app/services/sandbox.py`. There is no proto edit (D-8). A VmHWM-presence leg plus one ERROR log is added to the feature-300 startup memory probe (D-10). @AC-2 is rewritten to the two-run form (`result = {}` vs touched `numpy.ones(10_000_000)`; B−A ≥ 40 MiB, A > 0) (D-9).
- **Strongest open objection**: O-1 (blocking). The operator must confirm the `memory_used_bytes` definition. The current best is total leader VmHWM. The runner-up is the HWM delta (end minus the pre-exec VmHWM on the same fd). The question must carry the cap-alignment caveat: `sandbox.memory_bytes` is headroom above baseline, so total VmHWM is not cap usage. The other blockers:
  - O-2: whether the DO runtime renders a VmHWM line is still unverified. /sdd-spec must grep-verify where the startup-probe leg goes. The dev smoke is advisory only.
  - O-3: the OQ3 ruling must be recorded before the `docs/context-constitution.md:41` edit.
  - O-4: the operator must accept the self-forgery residuals, which are limited to the forger's own run.
  - Non-blocking: O-5 (C-14 deferral of the /insights memory display), O-9 (@AC-2 rewrite before /sdd-spec), O-10 (the CLAUDE.md and agent docstring must state baseline-included / 0-on-no-status / no grandchildren).
- **Floor status**: no breaches. The nonce comes from `secrets` (F-07). No migration (F-01). No pool change (F-06).
- **Uncovered @AC changes** (none covered by an operator decision yet): EXTEND 310@AC-1, 310@AC-2, 310@AC-3, 310@AC-4. PRESERVE 228@AC-4, 300@AC-5, 300@AC-12, 268@AC-1, 268@AC-2, 268@AC-3, 294@AC-37.
- **Next**: the operator answers O-1..O-5 in this file. Then re-run `/sdd-batch` to resume the debate from the state below.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. The classifier rests on D-1 to D-6. The memory source is the leader's VmHWM, read through a pre-seccomp fd. Four corrections from the adversary are adopted: the classifier order, AC-2 rewritten as a two-run scenario, a VmHWM presence leg on the startup probe, and no proto edit. All code changes are in services/xstockstrat-indicators/app/services/sandbox.py. The servicer, telemetry, proto and the SandboxResult signature do not change.\n\nA. Wrapper (_SANDBOX_WRAPPER, ~:548-653). Take the proposal-r2 block as written, with one change. design.md pastes it verbatim, using the .format brace doubling.\n- `class _ImportBlocked(ImportError)`. `_safe_import` (:562) raises it.\n- `_ms = os.open('/proc/self/status', os.O_RDONLY)` opens immediately after `{vmdata_probe}` (:620, which is after `{drop_uid}` :610) and before `_flt.load()` (:642). It is not in pass_fds.\n- A total `_status(kind)` sits after `_flt.load()`. It holds an inner try that does lseek(0) and read(8192), then parses `VmHWM:` × 1024. On any failure it reports 0. It prints the status line with flush=True, using print and not os.write (keeps tests/test_sandbox_watchdog.py:179 passing).\n- exec and json.dumps run inside one try. Each handler calls `_status`, then does a bare raise:\n  - `except _ImportBlocked` → `import_blocked`\n  - `except MemoryError` → `memory_exceeded`\n  - `except BaseException` → `raised`\n- Key presence: `'result' in _formula_globals` → print the `__OUTPUT__` marker, then `_status('ok')`. Otherwise → `_status('no_result')` and no marker.\n- The only change from the proposal: the status line keeps its leading \"\\n\", and the parser removes it (see B).\n\nB. Parent (execute_formula :670).\n- `nonce = secrets.token_hex(16)`, passed into .format.\n- `_STATUS_LINE` and `_split_status` are taken verbatim from proposal r2, with one change. When a matching status line is dropped, also remove the single trailing \"\\n\" from the last kept line. That is the newline the wrapper injected, so stdout is byte-identical to what the formula printed (C-18; FormulaRunResult.tsx:92-98).\n- `_split_status` is applied at three points:\n  - the watchdog-kill return (:764-773);\n  - right after communicate, before the first `_fail` (:800);\n  - the success return.\n- The timeout path (:774-783) keeps `stdout=\"\"` and memory 0.\n- For returncode != 0, replace :807-814 with this classifier (verbatim in design.md):\n```\nif status in (\"import_blocked\", \"memory_exceeded\"):\n    exit_reason = status\nelif proc.returncode == -signal.SIGKILL and _oom_kill_rose(oom_before):\n    exit_reason = \"memory_exceeded\"\nelif status is not None:\n    exit_reason = \"runtime_error\"\nelif any(m in stderr for m in _MEMORY_EXHAUSTED_MARKERS):\n    exit_reason = \"memory_exceeded\"\nelse:\n    exit_reason = \"runtime_error\"\n```\n- Why this order:\n  - Kernel counter evidence of a SIGKILL ranks above a `raised` or `ok` status (insights 2026-11-04). This preserves 300@AC-5 when the OOM killer strikes after `_status`.\n  - The stderr markers stay reachable only when no status line arrived, after the SIGKILL step. That is D-2.\n- Error text at :815-818 is unchanged.\n- Then `if status == \"no_result\": return _fail(\"formula did not assign result\", \"runtime_error\")`, before the feature-268 checks (:821-826), which are unchanged.\n- The \"is not allowed in sandbox\" substring test is deleted (D-2).\n\nC. Memory definition. Current best, pending operator confirmation (O-1):\n- `memory_used_bytes` = the leader's VmHWM over its whole life: the peak RSS of the sandboxed child, including the interpreter and the pre-imported modules.\n- It is 0, meaning \"not measured\", whenever no status line reached the parent: timeout, watchdog kill, signal, C-level abort, os._exit.\n- No VmRSS fallback and no watchdog peak_resident. One quantity on every path (R-2).\n- The O-1 question to the operator must carry the cap-alignment caveat. `sandbox.memory_bytes` is headroom above the measured baseline, so total VmHWM is not \"how much of the cap is used\".\n- Runner-up for the operator: HWM delta, VmHWM(end) − VmHWM(read on `_ms` just before exec). Its cost: 0 becomes ambiguous between \"not measured\" and \"used nothing\".\n- The definition is recorded in two places only, not in the proto:\n  - the service CLAUDE.md § Sandbox Security Model;\n  - the agent test_formula docstring (services/xstockstrat-agent/app/tools.py:1687-1689).\n- Both must say three things: the baseline is included, `memory_exceeded` normally comes with 0, and grandchildren are not counted.\n- indicators.proto:95 is NOT edited. Today it has no comment, and a comment would regenerate the checked-in stubs under the proto-freshness gate (C-09).\n\nD. Runtime-fact check (O-2).\n- Add a VmHWM presence leg to the existing feature-300 startup \"sandbox memory probe\" INFO line (service CLAUDE.md § Memory watchdog). It records whether a `VmHWM:` line is present, and logs ERROR once at startup when it is absent. That makes a silent prod 0 visible in logs (ledger fails 2026-11-09).\n- /sdd-spec must grep-verify the probe's code location (F-04).\n- The dev two-run smoke stays, labelled advisory and not enforced.\n\nE. Acceptance.\n- Amend docs/roadmap/features/310-fix-sandbox-result-contract/acceptance.feature @AC-2 before /sdd-spec. It must be the two-run discriminating form, replacing the absolute `numpy.zeros > 0` text that R-5 rejects:\n  - Run A is `result = {}`. Run B is `import numpy; a = numpy.ones(10_000_000); result = {\"s\": float(a[0])}`.\n  - B.memory_used_bytes − A.memory_used_bytes ≥ 40 MiB, and A.memory_used_bytes > 0.\n- The RED test mirrors it as a real subprocess run through the service venv.\n- Other RED tests and guards:\n  - AC-1 `ValueError(\"is not allowed in sandbox\")` → runtime_error.\n  - AC-3 and AC-4.\n  - `test_blocked_import` → import_blocked.\n  - A MemoryError inside json.dumps → memory_exceeded.\n  - The nonce is never in res.stdout, and stdout is byte-identical to the formula's own prints.\n  - A fake with a status line plus -SIGKILL plus oom rose → memory_exceeded.\n  - A servicer-level check that memory_used_bytes > 0.\n\nF. Build order.\n1. Implicit-{} enumeration, plus the operator check of dev/prod indicators.formulas.\n2. RED tests.\n3. Wrapper changes.\n4. Parent changes.\n5. Startup-probe leg.\n6. Docs: constitution :41 (only after the O-3 ruling is recorded), findings :22-23 and ~:63, service CLAUDE.md, the agent docstring, the report sidecars.\n7. Promote the scenarios with @feature-310.\n\nThe UI is unchanged, pending O-5.",
    "open_objections": [
      {
        "text": "O-1: the operator must confirm the memory_used_bytes definition. The current best is total leader VmHWM, with 0 meaning 'not measured' on paths with no status line. The runner-up is HWM delta (end minus the pre-exec VmHWM on the same fd). The question must state the cap-alignment caveat: sandbox.memory_bytes is headroom above baseline, so total VmHWM is not cap usage.",
        "blocking": true
      },
      {
        "text": "O-2: the readability-after-UID-drop half is shown by the fail-closed _VMDATA_PROBE (sandbox.py:610,:620). The DO runtime rendering a VmHWM: line is still unverified. The VmHWM presence leg plus one ERROR log on the startup probe is adopted, but its code location must be grep-verified in /sdd-spec. The dev two-run smoke is advisory only.",
        "blocking": true
      },
      {
        "text": "O-3: the OQ3 ruling text proposed in r2 must be recorded by the operator in context.md before docs/context-constitution.md:41 is edited.",
        "blocking": true
      },
      {
        "text": "O-4: the operator must explicitly accept the self-forgery residuals, each limited to the forger's own run: frame traversal to the nonce or to _ImportBlocked; raise MemoryError(); stderr 'MemoryError' then os._exit(1); printing an obtained nonce then os._exit; closing _ms, which reports 0.",
        "blocking": true
      },
      {
        "text": "O-5: C-14 deferral of the /insights memory display needs operator sign-off in context.md.",
        "blocking": false
      },
      {
        "text": "acceptance.feature @AC-2 must be rewritten to the two-run discriminating form (numpy.ones B against a result={} control A; B−A ≥ 40 MiB; A > 0) before /sdd-spec, so the C-16-promoted rule matches the RED test.",
        "blocking": false
      },
      {
        "text": "The service CLAUDE.md and the agent test_formula docstring must state three things about memory_used_bytes: the baseline is included, memory_exceeded and other no-status outcomes normally report 0 ('not measured'), and grandchildren are not counted.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "310@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "310@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "310@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "310@AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "228@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "300@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "300@AC-12",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "268@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "268@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "268@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294@AC-37",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Classifier order with 'any status → runtime_error' ahead of the -SIGKILL + _oom_kill_rose step (proposal r2). A run that printed ok or raised and was then OOM-killed would demote counter evidence to runtime_error, which regresses 300@AC-5.",
      "Adding a field comment at indicators.proto:95. Field 6 has no comment today, and adding one regenerates the checked-in Go and TS stubs under proto-freshness and proto governance, for documentation that the service CLAUDE.md and the agent docstring already carry.",
      "Falling back to VmRSS when VmHWM is absent. The field would mean peak on one path and current on another, the same mixed-meaning problem as R-2. A missing VmHWM is surfaced by the startup-probe ERROR instead.",
      "Keeping AC-2 as an absolute 'numpy.zeros > 0' scenario. Under total VmHWM every run passes it, and calloc'd zero pages are never touched, so it cannot discriminate (R-5).",
      "An AC-2 threshold of 70 MiB. That leaves about 6 MiB of margin against the 76.3 MiB numpy.ones buffer, because import transients can sit inside the high-water mark. 40 MiB still discriminates without flaking.",
      "Leaving the injected leading newline in SandboxResult.stdout. Every successful run would gain a stray blank line in the rendered output."
    ],
    "open_risks": [
      "Total VmHWM includes the interpreter and the eager-import footprint (tens of MB), so `x = 1` reports a large figure that users or agents may read as usage of the formula or of the cap. This is mitigated only by documentation unless the operator picks HWM delta.",
      "The VmHWM line and the fd read under seccomp are still unverified on the DO runtime image (ledger fails 2026-10-07). The startup-probe leg makes a miss visible but does not prevent it.",
      "VmHWM covers the leader only, so a formula that forks grandchildren under RLIMIT_NPROC is under-measured.",
      "Under memory pressure, _status may fail to print. Classification then falls to the stderr-marker fallback, and the AC-3 wording falls to the generic 'produced no output'.",
      "Recon risk 5 is still open: formulas in tests, template seeds, the UI default source, e2e fixtures and dev/prod rows may rely on the implicit {} result.",
      "Mocked-Popen fakes (tests/test_sandbox_isolation.py:65, :225-239) emit no status line. They pass only because of D-4 and the no-status fallback."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "P-06",
      "C-09",
      "C-11",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-04",
      "F-06",
      "F-07"
    ],
    "rationale": "The proposal's classifier and wrapper text rest correctly on D-1 to D-6. I checked the current classifier at sandbox.py:807-814, and the adversary confirmed that the wrapper keeps the order, descriptor and os.write tests passing. These adversary points are adopted:\n\n- **Classifier order.** Placing 'any status' before SIGKILL counter evidence would turn an OOM kill during teardown into runtime_error. The insights rule says the more specific evidence goes first. D-2 fixes only that the markers come after the SIGKILL step, so no reopen is needed.\n- **AC-2 text.** I verified that acceptance.feature:14-18 still says numpy.zeros > 0. That is exactly the absolute form R-5 locked out, and it cannot discriminate under total VmHWM. It is amended to the two-run numpy.ones form with a 40 MiB threshold.\n- **Proto comment.** I verified that indicators.proto:95 field 6 has no comment. Adding one is not free under proto-freshness. The minimal fix is to drop the proto edit and document the definition in the service CLAUDE.md and the agent docstring.\n- **Prod VmHWM.** The proposal's dev-smoke owner repeats the 2026-11-09 non-owner pattern. A startup-probe presence leg with an ERROR log is the ledger's own remedy.\n- **Stray blank line.** Fixed by stripping the injected newline in the parser.\n\nThe VmRSS fallback is rejected because it reintroduces mixed meanings, which is the R-2 spirit.\n\nThese stay open as operator questions:\n- the memory definition (O-1), now carrying the cap-alignment caveat and the HWM-delta runner-up;\n- O-3, O-4 and O-5.\n\nO-6, O-7 and O-8 are closed. The proposal answers each concretely, and the corrected classifier above is the verbatim text for design.md.\n\nNo Floor breaches:\n- the nonce comes from secrets (F-07);\n- no migration (F-01);\n- no pool change (F-06).",
    "register_delta": {
      "new_decisions": [
        {
          "text": "returncode != 0 classifier order: (1) status import_blocked or memory_exceeded; (2) -SIGKILL and _oom_kill_rose → memory_exceeded; (3) any other status → runtime_error; (4) no status and a _MEMORY_EXHAUSTED_MARKERS stderr hit → memory_exceeded; (5) runtime_error.",
          "evidence": "sandbox.py:807-814 (current), :813 counter evidence; 300@AC-5; insights 2026-11-04; adversary r2"
        },
        {
          "text": "indicators.proto is not edited. The memory_used_bytes definition is documented in the service CLAUDE.md § Sandbox Security Model and the agent test_formula docstring only.",
          "evidence": "indicators.proto:95 field 6 has no comment; proto-freshness gate regenerates packages/proto/gen; adversary r2 C-09"
        },
        {
          "text": "acceptance.feature @AC-2 is rewritten to the two-run form: A = `result = {}`, B = numpy.ones(10_000_000) touched; B−A ≥ 40 MiB and A > 0. It is mirrored by a real-subprocess RED test run through the service venv.",
          "evidence": "acceptance.feature:14-18 (numpy.zeros > 0, absolute); R-5; numpy.ones 80,000,000 B ≈ 76.3 MiB margin"
        },
        {
          "text": "The feature-300 startup sandbox memory probe gains a VmHWM-presence leg and logs ERROR once when the line is absent. The dev two-run smoke is advisory only. memory_used_bytes has no VmRSS fallback.",
          "evidence": "ledger fails 2026-11-09 (non-owner post-deploy smoke); service CLAUDE.md § Memory watchdog (DO not a native kernel); R-2"
        },
        {
          "text": "_split_status removes the matched status line and the one injected newline before it, so SandboxResult.stdout is byte-identical to the formula's own output.",
          "evidence": "proposal r2 print(\"\\n__STATUS__...\"); FormulaRunResult.tsx:92-98; D-5"
        }
      ],
      "new_rejected": [
        {
          "text": "Classifier with 'any status → runtime_error' ahead of the -SIGKILL + oom-rise step",
          "why": "demotes kernel OOM counter evidence for runs OOM-killed after _status, regressing 300@AC-5"
        },
        {
          "text": "VmRSS fallback when VmHWM is absent",
          "why": "field would mean peak on one path and current on another (R-2 spirit); absence is surfaced by the startup-probe ERROR instead"
        },
        {
          "text": "Field comment on indicators.proto:95 for the memory definition",
          "why": "triggers stub regeneration under proto-freshness and proto governance for documentation that the service CLAUDE.md and the agent docstring carry"
        },
        {
          "text": "AC-2 two-run threshold of 70 MiB",
          "why": "about 6 MiB of margin against high-water import transients makes it flaky; 40 MiB still discriminates"
        }
      ],
      "new_objections": [
        {
          "text": "acceptance.feature @AC-2 must be rewritten to the two-run discriminating form before /sdd-spec so the promoted rule matches the RED test.",
          "blocking": false
        },
        {
          "text": "Service CLAUDE.md and agent docstring must state that memory_used_bytes includes the baseline, that memory_exceeded and other no-status outcomes normally report 0 ('not measured'), and that grandchildren are not counted.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-6",
          "how": "Proposal r2 adds memory_used_bytes and its definition to the test_formula docstring (tools.py:1687-1689); the field is already returned (client.py:1178-1180)."
        },
        {
          "id": "O-7",
          "how": "Proposal r2 records the declared-output 'formula did not assign result' wording as deliberate: still runtime_error, and no scenario pins the old text."
        },
        {
          "id": "O-8",
          "how": "Wrapper block and classifier are given verbatim. The classifier text to paste into design.md is the corrected order in this synthesis."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

## Open Threads

- **Gate**: the `/sdd-design fix-sandbox-result-contract` full debate is halted at its approval gate after round 3 (gate policy: halt). design.md is not written and status.md is unchanged. The register is in `debate.md` (D-1..D-14, R-1..R-12, O-1..O-10). O-2, O-9 and O-10 closed this round.
- **Approach**: everything from round 2 stands: the wrapper and nonce status line, the D-7 classifier, the memory source and the build order (D-1..D-11). This round changes three things:
  - **Boot self-test (D-12).** It replaces both O-2 legs from the proposal. `run_startup_probe` (`sandbox_probe.py:309-320`) calls `sandbox.execute_formula("result = {}", {}, [])` with the function's own defaults, in its own `try/except` and independent of `_probe()`. The run goes through setuid, seccomp, the `_ms` read, the status parse and the classifier on the runtime kernel, before any user code. It logs one INFO line, `sandbox memory self-test exit_reason=%s memory_measured=%d`. It logs ERROR `sandbox memory_used_bytes unmeasurable on this runtime` on a non-success result, on memory <= 0, or when it raises. There is no per-run ERROR, no presence-only leg and no new gauge (R-10..R-12).
  - **@AC-2 (D-13).** `acceptance.feature:14-18` is replaced with the two-run scenario. It writes run B's source as a Gherkin DocString and opens with the precondition `Given the runtime renders a VmHWM line in /proc/self/status`. The threshold is 41943040 bytes.
  - **Docs (D-14).** Findings `:23` and the report-2 sidecar are marked resolved only conditionally: "where the boot self-test logs memory_measured>0; DO confirmation pending the first post-deploy boot log". The /sdd-execute integration PR author records that boot log line here at promotion.
- **Strongest open objection**: O-1 (blocking). The operator must confirm the `memory_used_bytes` definition.
  - Recommended: total leader VmHWM, with 0 meaning "not measured".
  - Runner-up: the HWM delta.
  - Caveat to state with the question: `sandbox.memory_bytes` is headroom above the baseline, so the total is not cap usage.

  The other operator-only items:
  - O-3 (blocking): record the OQ3 ruling text before the `docs/context-constitution.md:41` edit. Recommended text: "Stderr-substring failure classification is NOT a fixed contract. It is replaced by the per-run nonce status line (D-1). The `_MEMORY_EXHAUSTED_MARKERS` stderr check survives only as the no-status fallback (D-2/D-7 step 4), which keeps 228@AC-4."
  - O-4 (blocking): accept the self-forgery residuals. Each affects only the forger's own run:
    - frame traversal to the nonce or to `_ImportBlocked`;
    - `raise MemoryError()`;
    - stderr `MemoryError`, then `os._exit(1)`;
    - printing an obtained nonce, then `os._exit`;
    - closing `_ms`, which reports 0.
  - O-5 (non-blocking): C-14 sign-off. Recommended: "surface unchanged, justified". The new error classes already render via `FormulaRunResult.tsx:64`, and memory was never displayed.
- **Strongest open risk**: on DO App Platform, the child's `_ms` read under seccomp may yield no VmHWM, so every run would report 0. The boot self-test makes this loud at startup but does not prevent it. CI proves the mechanism only on the CI kernel. /sdd-spec must confirm three things about the boot run: it needs no config snapshot, it does not pollute per-run telemetry, and boot latency stays acceptable.
- **Floor status**: no breaches. The nonce comes from `secrets` (F-07). No migration (F-01). No pool change (F-06).
- **Uncovered @AC changes** (none covered by an operator decision yet): EXTEND 310@AC-1, 310@AC-2, 310@AC-3, 310@AC-4. PRESERVE 228@AC-4, 300@AC-5, 300@AC-12, 268@AC-1, 268@AC-2, 268@AC-3, 294@AC-37.
- **Next**: the operator answers O-1, O-3, O-4 and O-5 in this file, in one P-03 ask. Then re-run `/sdd-batch` to resume the debate from the state below.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. Sections A, B, C, E and F of the round-2 synthesis stand unchanged (wrapper, parent with the D-7 classifier, memory definition pending O-1, acceptance, build order). D-1 to D-11 stand. This round makes three changes. It replaces both of the proposal's O-2 legs with a boot self-test that runs the real wrapper. It fixes the AC-2 Gherkin form. It narrows how the docs describe the fix.\n\nD. Runtime-fact check (O-2). Replaces the proposal's legs 1(a) and 1(b), and implements D-10 through the real wrapper.\n\n- **Self-test function.** Add `_self_test()` in `services/xstockstrat-indicators/app/services/sandbox_probe.py`. It calls `sandbox.execute_formula(\"result = {}\", {}, [])` with the function's own defaults (`sandbox.py:670-679`: timeout 5000, grace 5000, memory_bytes 128 MiB). It therefore needs no config key and no new literal, and it can run before `wait_for_snapshot` (ordering test `tests/test_sandbox_probe.py:93-98`; precedent call at `:89`).\n- **What it exercises.** setuid drop, seccomp `_flt.load()`, the `_ms` lseek/read under the filter, `_status`/`_split_status`, and the classifier. All of this runs on the actual runtime kernel before any user code, and no formula can forge or latch the result.\n- **Where it is called.** Call `_self_test()` from `run_startup_probe` (`sandbox_probe.py:309-320`) in its own `try/except Exception`, independent of `_probe()`. The current early `return` at `:315-317` must not skip it. The never-raise contract holds.\n- **What it logs.** One INFO line: `sandbox memory self-test exit_reason=%s memory_measured=%d`.\n  - Log ERROR `\"sandbox memory_used_bytes unmeasurable on this runtime\"` when `exit_reason != \"success\"` or `memory_used_bytes <= 0`.\n  - Log the same ERROR, with the exception, when `_self_test` raises.\n- **What it does not do.** No new gauge. No per-run ERROR. `_STATUS_FIELDS` (`sandbox.py:101`) and `_parse_status` stay unchanged. `_first_time` (`sandbox.py:222-228`) is not used. There is no second `/proc/<pid>/status` read path in the probe, so the C-18 objection is moot.\n- **The dev two-run smoke** stays advisory (D-10).\n- **Test.** A real-subprocess test in `tests/test_sandbox_probe.py` asserts the INFO line has `memory_measured>0` on the CI kernel. A monkeypatched `execute_formula` returning `memory_used_bytes=0` asserts exactly one ERROR.\n\nE'. Acceptance (closes O-9). Replace `docs/roadmap/features/310-fix-sandbox-result-contract/acceptance.feature:14-18` verbatim with:\n\n```\n    @AC-2 @regression\n    Scenario: memory_used_bytes is a real per-run peak, not a fabricated or inherited figure\n      Given the runtime renders a VmHWM line in /proc/self/status\n      And run A is an ExecuteFormula request with formula_source \"result = {}\"\n      And run B is an ExecuteFormula request with formula_source:\n        \"\"\"\n        import numpy\n        a = numpy.ones(10_000_000)\n        result = {\"s\": float(a[0])}\n        \"\"\"\n      When the sandbox runs A and then B\n      Then A's memory_used_bytes is greater than 0\n      And B's memory_used_bytes exceeds A's by at least 41943040\n```\n\nThe `Given` precondition keeps the C-16-promoted rule from claiming more than the runtime guarantees.\n\nG. Docs (closes O-10, with the adversary's overstatement fix).\n\n- **Definition text.** The round-3 text goes verbatim into the service `CLAUDE.md` § Sandbox Security Model. A condensed version goes into the agent `test_formula` docstring (`services/xstockstrat-agent/app/tools.py` ~`:1687-1689`).\n- **Findings row.** Mark `services/xstockstrat-indicators/docs/context-constitution-findings.md:23` and the report-2 sidecar as \"resolved where the boot self-test logs memory_measured>0; DO confirmation pending the first post-deploy boot log\". The /sdd-execute integration PR author records that log line (or the ERROR) in `context.md` at promotion.\n- **Constitution edit.** The edit to `docs/context-constitution.md:41` still waits for the O-3 ruling.\n\nOperator decision block. Surface in one P-03 ask; these are recommendations, none assumed.\n\n- **O-1, memory definition.** Recommend total leader VmHWM, with 0 meaning \"not measured\". The runner-up is the HWM delta. State the caveat with the question: `sandbox.memory_bytes` is headroom above the baseline, so the total is not cap usage.\n- **O-3, OQ3 ruling text for `context.md`.** \"Stderr-substring failure classification is NOT a fixed contract. It is replaced by the per-run nonce status line (D-1). The `_MEMORY_EXHAUSTED_MARKERS` stderr check survives only as the no-status fallback (D-2/D-7 step 4), which keeps 228@AC-4.\"\n- **O-4, self-forgery residuals.** Each affects only the forger's own run:\n  - frame traversal to the nonce or to `_ImportBlocked`;\n  - `raise MemoryError()`;\n  - writing `MemoryError` to stderr, then `os._exit(1)`;\n  - printing an obtained nonce, then `os._exit`;\n  - closing `_ms`, which reports 0 for that run only.\n  - The \"one ERROR per process\" residual is gone with leg 1(b).\n- **O-5, C-14.** Recommend recording \"surface unchanged, justified\":\n  - `/insights` is not stale, because the new failure classes and the missing-`result` error already render through the existing exit and error path (`FormulaRunResult.tsx:64`);\n  - memory was never displayed;\n  - so no follow-up feature is filed unless the operator names one.",
    "open_objections": [
      {
        "text": "O-1: the operator must confirm the memory_used_bytes definition. Recommended: total leader VmHWM, with 0 meaning 'not measured'. Runner-up: HWM delta. Caveat: sandbox.memory_bytes is headroom above the baseline, so the total is not cap usage.",
        "blocking": true
      },
      {
        "text": "O-3: the operator must record the OQ3 ruling text in context.md before docs/context-constitution.md:41 is edited.",
        "blocking": true
      },
      {
        "text": "O-4: the operator must explicitly accept the self-forgery residuals, each limited to the forger's own run: frame traversal to the nonce or to _ImportBlocked; raise MemoryError(); stderr 'MemoryError' then os._exit(1); printing an obtained nonce then os._exit; closing _ms, which reports 0.",
        "blocking": true
      },
      {
        "text": "O-5: C-14 needs operator sign-off in context.md. The recommended framing is 'surface unchanged, justified': the new error classes already render via FormulaRunResult.tsx:64, and memory was never displayed. The alternative is to name a follow-up feature.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "310@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "310@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "310@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "310@AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "228@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "300@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "300@AC-12",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "268@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "268@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "268@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294@AC-37",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Startup VmHWM-presence leg reading the probe child's /proc status (proposal r3 1(a)). The probe child never loads seccomp or opens _ms (_PROBE_SCRIPT sandbox_probe.py:48-103), so the leg checks only that the field exists. Ledger fails 2026-11-09 forbids exactly that. It also duplicates the _try_sample read at :241 (C-18).",
      "Per-run once-per-process ERROR when a status-bearing run measures 0 (proposal r3 1(b)). Any formula can latch it by closing or zeroing _ms. It fires only after the first user run. It gives a false ERROR on a MemoryError status run under RLIMIT_DATA. It cannot tell a runtime defect from user action.",
      "Per-run label-free memory_measured gauge. Any formula drives it to 0 on its own run, so it flaps, and it adds a per-run telemetry write for a one-time runtime fact.",
      "Keeping leg 1(a) alongside the boot self-test. The self-test's memory_measured=0 already reveals a missing VmHWM line, so the leg is redundant.",
      "Plain-step Gherkin with escaped \\n and \\\" for run B's formula source. Gherkin step text has no escapes, so the promoted rule would hold an ambiguous source. A DocString is used instead."
    ],
    "open_risks": [
      "On DO App Platform (not a native kernel), the child's _ms read under seccomp may fail or render no VmHWM. Every run would then report 0. The boot self-test makes this loud at startup, before user code, but does not prevent it. CI proves the mechanism only on the CI kernel (ledger fails 2026-10-07).",
      "The boot self-test adds one sandbox child at startup, with the watchdog armed at the 128 MiB default. /sdd-spec must confirm three things: execute_formula needs no config snapshot at probe time; it emits no user-facing per-run telemetry or counters that a boot run would pollute; and boot latency stays acceptable.",
      "Total VmHWM includes the interpreter and eager-import baseline, so small formulas report tens of MB. This is mitigated only by documentation unless the operator picks HWM delta (O-1).",
      "VmHWM covers the leader only. Grandchildren forked under RLIMIT_NPROC are under-measured.",
      "Under memory pressure, _status may fail to print. Classification then falls to the stderr-marker fallback, and the AC-3 wording falls to the generic 'produced no output'.",
      "Recon risk 5, template half settled: 008_seed_formula_templates.up.sql:8-16 has exactly one top-level result assignment per row, 9 of 9 (adversary-verified). Saved user rows in dev/prod indicators.formulas still need the operator DB check (OQ1). Tests, the UI default source and e2e fixtures still need enumeration.",
      "Mocked-Popen fakes (tests/test_sandbox_isolation.py:65, :225-239) emit no status line. They pass only because of D-4 and the no-status fallback."
    ],
    "constitution_rules_touched": [
      "P-02",
      "P-03",
      "P-06",
      "C-09",
      "C-11",
      "C-13",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-04",
      "F-06",
      "F-07"
    ],
    "rationale": "I verified the adversary's central O-2 objection.\n\n- **Why the proposal's legs fall short.** `_probe()` (sandbox_probe.py:201-236) spawns `_PROBE_SCRIPT` with no seccomp load. A VmHWM-presence check on that child therefore never exercises the post-exec `_ms` lseek/read under the filter, which is the runtime fact O-2 names. Leg 1(b) is user-triggerable and latched, so it cannot serve as the owner.\n- **Why a boot self-test works.**\n  - `execute_formula` has full defaults (sandbox.py:670-679).\n  - It is already called beside the probe in tests (test_sandbox_probe.py:89).\n  - `run_startup_probe` runs before `wait_for_snapshot` (main.py:46; ordering test :93-98).\n  - So a self-test through the real wrapper is cheap, needs no config, and is an owned, unforgeable check on the runtime kernel. That satisfies ledger fails 2026-11-09 and closes O-2.\n- **Register consistency.**\n  - The self-test is a stronger realisation of D-10's startup ERROR leg, not a contradiction.\n  - It adds no VmRSS fallback (R-7).\n  - It adds no proto edit (D-8/R-8).\n  - It keeps the 40 MiB threshold (D-9/R-9).\n- **O-9.** Closes with a DocString form, because Gherkin step text has no escapes. A runtime precondition `Given` keeps the promoted C-16 rule honest.\n- **O-10.** Closes. The definition text covers the baseline, the 0-on-no-status case and grandchildren.\n- **Doc overstatement.** The adversary's objection is adopted directly: the findings row and sidecar are marked conditional on the self-test log.\n- **Citation fix.** `_first_time` is at sandbox.py:222-228, not :237-239.\n- **Operator items.** O-1, O-3, O-4 and O-5 remain operator-only. Each stays open with a recommended answer packaged for one P-03 ask. O-4 drops the 'one ERROR per process' residual now that leg 1(b) is gone.\n- **Floor.** No Floor breach:\n  - the nonce comes from secrets (F-07);\n  - no migration (F-01);\n  - no pool change (F-06).",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-10's startup ERROR leg is realised as a boot self-test. run_startup_probe calls sandbox.execute_formula(\"result = {}\", {}, []) with the function's defaults, in its own try/except and independent of _probe() success. It logs INFO 'sandbox memory self-test exit_reason=%s memory_measured=%d', and logs ERROR 'sandbox memory_used_bytes unmeasurable on this runtime' when exit_reason != success, when memory <= 0, or when it raises. There is no per-run ERROR, no presence-only leg and no new gauge.",
          "evidence": "sandbox_probe.py:48-103 (probe child has no seccomp), :201-236, :309-320; sandbox.py:670-679 defaults; tests/test_sandbox_probe.py:89,93-98; main.py:46; ledger fails 2026-11-09; adversary r3"
        },
        {
          "text": "The promoted @AC-2 gives run B's formula source as a Gherkin DocString and begins with a runtime precondition Given 'the runtime renders a VmHWM line in /proc/self/status'.",
          "evidence": "Gherkin step text has no escapes; C-16 promotion fidelity; acceptance.feature:14-18; adversary r3"
        },
        {
          "text": "context-constitution-findings.md:23 and the report-2 sidecar are marked resolved only conditionally ('where the boot self-test logs memory_measured>0; DO confirmation pending the first post-deploy boot log'). The /sdd-execute integration PR author records that boot log line in context.md at promotion.",
          "evidence": "ledger fails 2026-11-10 (closes a findings row); proposal r3 strongest-risk; adversary r3"
        }
      ],
      "new_rejected": [
        {
          "text": "Startup VmHWM-presence leg reading the probe child's /proc status",
          "why": "the probe child loads no seccomp and never does the _ms lseek/read, so it checks only that the field exists (ledger fails 2026-11-09); it also duplicates the _try_sample read (C-18)"
        },
        {
          "text": "Per-run once-per-process ERROR when a status-bearing run measures 0",
          "why": "user-triggerable and latched (close or zero _ms); fires only after the first user run; false ERROR on a MemoryError status run; cannot separate a runtime defect from user action"
        },
        {
          "text": "Per-run label-free memory_measured gauge",
          "why": "any formula drives it to 0 on its own run, so it flaps; it adds a per-run telemetry write for a one-time runtime fact"
        }
      ],
      "new_objections": [],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "Boot self-test runs the real wrapper (setuid, seccomp, _ms read, status parse) on the runtime kernel inside run_startup_probe before user code and logs ERROR on memory<=0. The discriminating two-run real-subprocess RED test is D-9. The DO confirmation is owned via the conditional findings marking and the first boot log recorded at promotion."
        },
        {
          "id": "O-9",
          "how": "Verbatim @AC-2 replacement given in DocString form with the runtime precondition Given and the 41943040-byte (40 MiB) two-run threshold."
        },
        {
          "id": "O-10",
          "how": "Verbatim definition text (baseline included, 0 = not measured on timeout/watchdog kill/signal/abort/os._exit so most memory_exceeded report 0, grandchildren not counted) for the service CLAUDE.md, condensed into the agent test_formula docstring."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-indicators fix site; xstockstrat-ui and xstockstrat-agent pass-through consumers; key reuse patterns: the `_fail` closure and feature-268 wording; "more specific evidence first" classification).
- Phase 1 Grilling: 3 rounds (full). Termination: approved by the operator at the design gate (Floor clear). Chosen approach: a per-run nonce status line on the child's stdout carries the failure class, the missing-`result` signal and the leader VmHWM; the D-7 classifier keeps the stderr markers only as the no-status fallback; a boot self-test through the real wrapper owns the runtime fact. Rejected: R-1..R-12 (getrusage, mixed memory quantities, second pipe, exit codes, VmRSS fallback, proto comment, presence-only probe leg, per-run ERROR/gauge).
- Constitution rules touched: P-02, P-03, P-06, C-09, C-11, C-13, C-14, C-15, C-16, C-18, F-01, F-04, F-06, F-07. Floor breaches: none.
- Status: spec-ready → design-approved. design.md written; debate.md State → approved (no new rows, no reopen petitions).

### Operator decisions (binding, recorded 2026-11-20)

- **O-1** (design gate): `memory_used_bytes` is the total leader VmHWM, with 0 meaning "not measured".
- **O-3**, OQ3 ruling text, verbatim: "Stderr-substring failure classification is NOT a fixed contract. It is replaced by the per-run nonce status line (D-1). The `_MEMORY_EXHAUSTED_MARKERS` stderr check survives only as the no-status fallback (D-2/D-7 step 4), which keeps 228@AC-4." This unblocks the `services/xstockstrat-indicators/docs/context-constitution.md:41` edit.
- **O-4**: the self-forgery residuals are accepted, each limited to the forger's own run (frame traversal to the nonce or `_ImportBlocked`; `raise MemoryError()`; stderr `MemoryError` then `os._exit(1)`; printing an obtained nonce then `os._exit`; closing `_ms`, which reports 0).
- **O-5** (C-14, non-blocking): no operator decision recorded. Still open; see Open Threads.

### Decisions

- Chosen approach is design.md § Chosen Approach (register D-1..D-14).
- C-16: no CHANGE to any promoted guarantee. PRESERVE 228@AC-4, 300@AC-5, 300@AC-12, 268@AC-1, 268@AC-2, 268@AC-3, 294@AC-37. EXTEND 310@AC-1..4.
- No ledger line written: the reusable trap (a runtime-fact check must exercise the real code path) is already on record at ledger fails 2026-11-09.

## Open Threads

- [ ] `acceptance.feature` @AC-2 still has the old `numpy.zeros > 0` text; apply the verbatim replacement in design.md § 6 (D-9, D-13) — target: before `/sdd-spec` traces scenarios.
- [ ] O-5 / C-14: operator sign-off on "/insights surface unchanged, justified" (or a named follow-up feature) is not recorded — target: operator answer before the `/sdd-spec` consumer-surface step.
- [ ] The verbatim proposal-r2 wrapper block and the round-3 `memory_used_bytes` definition text were not persisted in the register; design.md records their binding properties only — target: `/sdd-spec` writes the exact text (wrapper step, docs step).
- [ ] DO App Platform may render no VmHWM under seccomp, so every run would report 0; the boot self-test only makes it loud — target: integration PR (record the first post-deploy boot log line, or the ERROR, here).
- [ ] Boot self-test: confirm `execute_formula` needs no config snapshot at probe time, pollutes no per-run telemetry, and keeps boot latency acceptable — target: `/sdd-spec` boot self-test step.
- [ ] Total VmHWM includes the interpreter and eager-import baseline (tens of MB for small formulas); leader only, grandchildren under-measured — target: docs step.
- [ ] Under memory pressure `_status` may fail to print; classification falls to the stderr-marker fallback and AC-3 wording to "produced no output" — target: parent-changes step (test).
- [ ] Implicit-`{}` reliance (recon risk 5): template seeds are settled (9 of 9 assign `result`); dev/prod `indicators.formulas` rows need the operator DB check (OQ1); tests, the UI default source and e2e fixtures need enumeration — target: build step 1.
- [ ] Mocked-Popen fakes (`tests/test_sandbox_isolation.py:65`, `:225-239`) emit no status line and pass only through D-4 and the no-status fallback — target: parent-changes step.
- [ ] debate.md still shows O-1, O-3, O-4 and O-5 as `open`: this run was given no Status-cell changes for them. O-1, O-3 and O-4 are answered by the operator decisions above; O-5 is not — target: next register write.

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status: design-approved → implementation-ready.
- Tree: `origin/feature/fix-sandbox-result-contract@90a2fd0e`. recon.md's `sandbox.py` lines still hold; design.md's "(debate.md)" citations were re-grepped.
- `acceptance.feature` @AC-2 replaced with the design.md § 6 verbatim two-run scenario (D-9, D-13) before tracing scenarios.
- Operator decisions O-1, O-3 and O-4 (recorded 2026-11-20, above) are applied as binding. O-5 was not answered in this run.

### Decisions

- Steps: 1 service + 2 test (the whole contract in `app/services/sandbox.py`); 3 service + 4 test (boot self-test in `sandbox_probe.py`); 5 service + 6 test (agent `test_formula` docstring + `docs/runbooks/mcp-tools.md`); 7 test (`/insights` Playwright, test-only); 8 docs.
- No proto, migration or config step (D-8, F-01, F-07). No `**Lands with**` unit: each step passes its own Verification alone.
- Wrapper and parent land in one service step: the template's `{nonce}` field and the parent's `.format(nonce=…)` cannot be committed apart.
- The verbatim wrapper block, `_split_status`, the D-7 classifier, the self-test code and the `memory_used_bytes` definition text (O-10) are now written out in implementation-spec.md Steps 1, 3 and 8. This closes the "verbatim texts not persisted" thread.
- Promotion of `@AC-1..4` with `@feature-310` is left to `/sdd-execute` at integration; it is not a spec step.
- Report sidecars are **not** edited: the sidecar contract (`.claude/skills/sdd-qa/reference/defect-filing.md:26-48`) allows only a status token and a `ref:` line, and a `triaged` report counts as resolved when its feature launches. The D-14 conditional wording goes into the findings row (Step 8). This narrows design.md § 7 and is flagged for `/sdd-review impl-spec`.

### Key codebase findings

- **Break radius measured.** The full Step 1 + Step 3 change was applied to the working tree temporarily, the unchanged suite was run through the service venv, and the change was reverted (nothing committed): 571 passed before, 571 passed with it. No existing indicators test relies on the implicit `{}`, on the deleted stderr test, or on `memory_used_bytes == 0`.
- Implicit-`{}` enumeration in the repo is complete: tests (above), the seeded system formula (`app/formulas/fundamentals_value_quality.py:186`), the five UI starter templates (`formulaReference.ts:209,227,256,276,309`); the UI e2e suite stubs `ExecuteFormula` (`formulas.spec.ts:231`). Saved dev/prod `indicators.formulas` rows remain an operator check.
- Prototype figures on this kernel (advisory): `result = {}` with `allowed_imports=["numpy"]` reported 50,663,424 bytes and the @AC-2 run B exceeded it by 80,027,648 (threshold 41,943,040); with `[]` it reported about 15.7 MB in about 50 ms. The @AC-2 test gives both runs `allowed_imports=["numpy"]` so the import baseline is common.
- A `dict` subclass whose `items()` raises `MemoryError` is a working recipe for "MemoryError inside `json.dumps`" (a `float` subclass with a raising `__repr__` is not: the C encoder bypasses it).
- Boot self-test risk resolved by reading the code: `execute_formula` (`sandbox.py:670-679`) reads no config and records no per-run telemetry (`record_sandbox_execution` is in the servicer, `servicer.py:383`). It can only latch the existing once-flags (`_warn_unobservable_once`, the `oom_score_adj` warning).
- `run_startup_probe`'s early `return` is at `sandbox_probe.py:318`; the spec moves the existing body into `_run_memory_probe()` so the self-test always runs.
- Agent: `memory_used_bytes` is already returned as a JSON string (`client.py:1178-1180`, `always_print_fields_with_no_presence=True`); `docs/runbooks/mcp-tools.md:1060-1062` mirrors the docstring's return list.
- The findings file has no row for the 2026-10-22 missing-result report; only `:22`, `:23` and the link rows `:62-63` change.
- Pre-existing flake, unrelated to this feature: `tests/test_sandbox_watchdog.py::test_ac8_fork_bomb_is_not_a_success_the_service_recovers_and_nothing_is_unobservable` failed 7 of 25 runs **alone on the unmodified tree** on this kernel (`CANNOT_OBSERVE_MSG` assertion); full-suite runs passed 4 of 4. Not recorded as a defect report in this run (this session may write only this feature directory).

## Open Threads

- [ ] O-5 / C-14: operator sign-off on "/insights surface unchanged, justified" (or a named follow-up feature for a memory display) is still not recorded — target: before `/sdd-execute` runs Step 7.
- [ ] OQ1: operator check of dev and prod `indicators.formulas` for saved formulas that never assign `result` — target: before the integration PR; record the result here.
- [ ] DO App Platform may render no VmHWM under seccomp; record the first post-deploy `sandbox memory self-test` log line (or the ERROR) here — target: integration PR (D-14).
- [ ] Sidecar reading of design.md § 7 (sidecars untouched, conditional wording in findings `:23`) needs confirmation — target: `/sdd-review fix-sandbox-result-contract impl-spec`.
- [ ] Step 7 is a characterisation test (`**TDD**: N/A`), added so the UI surface has a step without changing UI code — target: `/sdd-review fix-sandbox-result-contract impl-spec` confirms or drops it.
- [ ] The pre-existing `test_ac8_fork_bomb…` isolation flake needs a defect report via `/sdd-qa defect` — target: next session with write access outside this feature directory.
- [ ] debate.md still shows O-1, O-3, O-4 and O-5 as `open`; O-1, O-3 and O-4 are answered — target: next register write (`/sdd-design` owns the register).
- [x] `acceptance.feature` @AC-2 rewrite — done this session.
- [x] Verbatim wrapper block and definition text — written in implementation-spec.md Steps 1 and 8.
- [x] Boot self-test config/telemetry/latency check — resolved (Key codebase findings).
- [x] Mocked-Popen fakes with no status line stay green — measured (571 passed); Step 2 adds the no-status fallback test.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 9 warnings; overlap WARN (file-level, rebase-only). Advisory — did not block; lifecycle unchanged. No Floor (`F-*`) breach.
- Tree reviewed: `origin/feature/fix-sandbox-result-contract@8d01d15a`. implementation-spec.md edited in `ffb8420d`.

### Addressed (implementation-spec.md)

- [x] Tree pin: re-pinned from `@90a2fd0e` to `@8d01d15a`. `90a2fd0e..8d01d15a` is 6 commits that touch only this feature directory (`git diff --stat` outside it is empty), so every `path:line` anchor holds.
- [x] Wording: "the deleted stderr test" → "the deleted stderr substring branch (`sandbox.py:809`)". Re-grepped: no file under `services/xstockstrat-indicators/tests` contains "is not allowed in sandbox".
- [x] Step 3: the boot self-test's startup-latency trade-off (one real sandbox run per boot, about 50 ms on the prototype, after `init_telemetry()` at `app/main.py:46`, failures caught and logged) is now stated in Codebase Evidence.
- [x] design.md § 7 sidecar narrowing (P-03): logged in the spec's Deviation Log as a spec-time deviation. design.md itself is not amended. Operator confirmation is still open (below).
- [x] Step 1 review load: Step Dependencies now states why Step 1 is not split and that the `571 passed` prototype figure is advisory (the reviewer did not re-run it).
- [x] Flake: Step Dependencies now says the Step 1, 2 and 3 full-suite Verification can go red on `test_ac8_fork_bomb…` alone and that the executor records such a run here.
- [x] Overlap: Step Dependencies gains a rebase-only note. Re-verified on `origin/main-dev`: `345-authelia-sso` is `implementation-ready` and edits `services/xstockstrat-agent/app/tools.py` (its spec `:985`) and `docs/runbooks/mcp-tools.md` (`:2319`); `360-fix-mcp-tools-page` is `code-completed` and edits `mcp-tools.md` (`:958`). `300-fix-sandbox-memory-cap` is `launched`, so its `sandbox.py` and test edits are already in this tree and it is not an in-flight collision.

### Unresolved ⚠ carried into execution

- Step 7: C-14 — operator gate O-5 is not recorded; Step 7 is blocked until it is — [ ] unaddressed
- Step 7: test-only step with `**TDD**: N/A` (characterisation); confirm or drop at the O-5 gate — [ ] unaddressed
- Integration PR: OQ1 operator DB check of dev and prod `indicators.formulas` (saved formulas that never assign `result` will start failing) — [ ] unaddressed
- Step 8: sidecar reading of design.md § 7 needs operator confirmation (logged in the Deviation Log, not confirmed) — [ ] unaddressed
- Steps 1-3: `test_ac8_fork_bomb…` pre-existing flake has no defect report — [ ] unaddressed
- Step 5: re-grep the `tools.py:1687-1689` and `mcp-tools.md:1060-1062` anchors after any rebase onto 345 or 360 — [ ] unaddressed

- Overlap findings: file-level only (`tools.py` and `mcp-tools.md` vs 345; `mcp-tools.md` vs 360). No migration, proto-field or config-key collision. The 17 batch peer features' Step file lists were not verifiable in the scan (likely touchers of `tools.py`: fix-mcp-deadline-budget, fix-agent-bearer-secret-orphan, fix-agent-mcp-transport-fallthrough; of `e2e/insights/formulas.spec.ts`: fix-ui-gating-gaps).

## Open Threads

- [ ] O-5 / C-14: operator sign-off on "/insights surface unchanged, justified" (or a named follow-up feature for a memory display) is not recorded; the same answer confirms or drops Step 7 — target: `/sdd-execute` checkpoint before Step 7.
- [ ] OQ1: operator check of dev and prod `indicators.formulas` for saved formulas that never assign `result` — target: before the integration PR; record the result here.
- [ ] Sidecar reading of design.md § 7 (sidecars untouched, conditional wording in the findings row) is logged in the Deviation Log but not operator-confirmed — target: `/sdd-execute` checkpoint before Step 8.
- [ ] The pre-existing `test_ac8_fork_bomb…` isolation flake needs a defect report via `/sdd-qa defect` — target: next session with write access outside this feature directory.
- [ ] Batch peer features' file lists are unverified against Step 5 (`tools.py`) and Step 7 (`formulas.spec.ts`) — target: `/sdd-execute` Step 0 discovery, and `/merge-train` ordering.
- [ ] DO App Platform may render no VmHWM under seccomp; record the first post-deploy `sandbox memory self-test` log line (or the ERROR) here — target: integration PR (D-14).
- [ ] debate.md still shows O-1, O-3, O-4 and O-5 as `open`; O-1, O-3 and O-4 are answered — target: next register write (`/sdd-design` owns the register).

## Session 2026-11-21 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: the operator approved the plan with this record (binding, verbatim):
  `{"mainDev":"8baf3976c17f2f074f834d63ad9a1e8ffd8af22e","dev":"0ab25f5ef66692773f8839bf848d166a54ccf75f","specHash":"dfb189ef7540296bcb7afec59fae90c351ced699","directive":"conditional","pending":[1,2,3,4,5,6,7,8],"mismatches":[{"n":5,"detail":"Line anchors in services/xstockstrat-agent/app/tools.py and docs/runbooks/mcp-tools.md have moved. These files changed after 8d01d15a, including 51da5e06 from 360-fix-mcp-tools-page and 4f14f897, 4330f0ef, 8b472521, 0787a1a1, 99530332 and 9d45f208. The content is unchanged and only the lines differ. `async def test_formula(` is now at tools.py:1817 (spec says :1669). The docstring return list ('Returns the full sandbox result: ... execution_ms (int64 as a JSON string).') is now at tools.py:1835-1837 (spec :1687-1689). The tool body is now about :1838-1849 (spec :1690-1700). The MessageToDict return in client.py is now :1199-1201 (spec :1178-1180). The mcp-tools.md **Return** paragraph is now :1172-1174 (spec :1060-1062). The proto anchors hold: `int64 memory_used_bytes = 6` at indicators.proto:95. Both Files paths exist. The spec already tells the executor to re-grep these anchors after a rebase."},{"n":6,"detail":"Line anchors in services/xstockstrat-agent/tests/test_tools.py have moved; the content still matches. `_make_server()` is at :33 (spec :27-30). `_tool_fn` is at :39 (spec :33-34). The manage_strategy description pattern is at :1094-1095 (spec :1088-1089). `class TestAdditiveTools` is at :1944 (spec :1835). `test_test_formula_dispatches_inline_source` is at :1946 (spec :1837). The Files path exists."},{"n":8,"detail":"Line anchors have moved after commits d1c97273, 5c4cc935 and 99530332. The content and the text the Verification greps target are still present. In services/xstockstrat-indicators/CLAUDE.md: `## Sandbox Security Model` is at :104 (spec :117). The 'Execution enforcement' bullet is at :159-162 (spec :213-216). The 'No-output failure (feature 268)' bullet is at :163-168 (spec :217-222). The feature-300 'Memory watchdog and startup probe' observability bullet is at :174-181 under '## Observability (feature 294-signal-map-instrumentation)' (spec :230-236). In docs/context-constitution.md, the 'Sandbox failure classification by stderr substring-match is a fixed contract' row is at :37 (spec :41). context-constitution-findings.md matches the spec: :22 and :23 hold the two open rows, :62-63 hold the report link rows, :3 holds the refresh header, and there is no '2026-10-22-indicators' row. All three Files paths exist."}]}`
- Merge: `origin/main-dev@8baf3976` is already an ancestor of the dev branch, so no merge was needed.
- Re-spec (directive conditional, line anchors only; no instruction text, Files or Verification change):
  - `915771c1` respec(fix-sandbox-result-contract): align steps 5,6,8 with current codebase
- Tooling setup (steps 1-8): python3.13 ✓ · uv ✓ 0.11.32 (ruff/pytest via per-step `uv sync`) · pnpm ✓ 9.15.9 · Node 24 ✓ at `/opt/node24` (the default PATH `node` is v22) · Playwright Chromium ✓ (`/opt/pw-browsers`) · docker ✓. Pre-commit hook check: hook=0.
- Status: `implementation-ready` → `in-progress`.

```sdd-batch-setup
{"mainDev":"8baf3976c17f2f074f834d63ad9a1e8ffd8af22e","date":"2026-11-21"}
```

### Step 1 — service: nonce status line, classifier, missing-result failure and measured memory in the sandbox [done]
- Landed the whole result contract in `sandbox.py`. The pieces are `_ImportBlocked`, the `_ms` fd opened before seccomp, a total `_status` that prints the nonce status line with the leader VmHWM, and key-presence `result` detection inside a handler chain that re-raises. In the parent, `secrets.token_hex(16)` makes the nonce, `_split_status` strips the line on the watchdog-kill and post-communicate paths, the D-7 classifier replaces the guard-message substring branch (O-3), `no_result` fails with "formula did not assign result", and `memory_used_bytes` is measured on `_fail` and success.
- TDD (no `**Covers**`; Step 2 owns the @AC tests): RED came from the Verification on the pre-change tree (`.sdd-logs/v-1.log`, exit=0). `grep -c "memory_used_bytes=0"` printed `4` (expect 2) and the substring grep matched `809:                if "is not allowed in sandbox" in stderr:` (expect none). A scratch behaviour probe (`.sdd-logs/v-2.log`, exit=1) printed `no_result: True success '' 0` and `guard_msg: False import_blocked`. GREEN came from the probe (`.sdd-logs/v-6.log`, exit=0), which printed `no_result: False runtime_error 'formula did not assign result' 15777792`, `guard_msg: False runtime_error` and `FAILURES: []`. The Verification (`.sdd-logs/v-5.log`, exit=0) printed `610 passed in 70.12s`, `Total coverage: 87.05%`, `All checks passed!`, `65 files already formatted`, grep count `2`, no substring match, and `781:                pass_fds=(w,) if w >= 0 else (),`.
- The first GREEN Verification (`.sdd-logs/v-3.log`) printed exit=0 while ruff reported E501 on the verbatim `__OUTPUT__` print line. The exit status comes from the trailing grep, so a non-zero `&&` chain does not show in `exit=`. The line was split (Deviation Log) and the Verification re-ran green. The `test_ac8_fork_bomb…` flake did not appear in any run.
- Config-key wiring gate: not applicable (no config key, no migration).
- Files modified: `services/xstockstrat-indicators/app/services/sandbox.py`
- Deviations: E501 line split; RED evidence from greps plus a scratch probe; 610 vs 571 suite count (full detail in Deviation Log)

### Step 2 — test: sandbox result-contract regression tests (@AC-1..4) [done]
- Added `TestSandboxResultContract`, which runs 11 cases through a real subprocess. Also added a fake for the no-status stderr-marker case and a fake where OOM-counter evidence outranks the status line (`_killed_proc` gained `stdout=""`). Two servicer tests cover @AC-3 and @AC-2.
- TDD RED: run with `sandbox.py` temporarily restored to `4f57ba17~1` (`.sdd-logs/v-1.log`, exit=0 because the trailing grep sets the status). It printed `10 failed, 615 passed`.
  - AC-1 red: `assert 'import_blocked' == 'runtime_error'`.
  - AC-2 red: `assert 0 > 0`.
  - AC-3 red: `assert True is False`.
  - Stdout red: `assert '\n__OUTPUT__:{}\n' == ''`.
  - The OOM-outranks fake red: `AttributeError: module 'app.services.sandbox' has no attribute 'secrets'`.
- TDD GREEN (`.sdd-logs/v-3.log`, exit=0) printed `625 passed in 73.47s`, `Total coverage: 87.11%`, `All checks passed!`, `65 files already formatted` and `11 passed, 20 deselected`. The grep matched one line only: `tests/test_sandbox.py:399:            return sandbox.SandboxResult(`.
- The first GREEN run (`.sdd-logs/v-2.log`) had 625 passed, but ruff reported E501 on a new test line. `exit=0` did not show it, because the trailing grep sets the status. The line was split and the Verification re-ran green.
- Flake (P-03): `test_ac8_fork_bomb_is_not_a_success_the_service_recovers_and_nothing_is_unobservable` failed in the RED run, on the pre-Step-1 tree, at the `CANNOT_OBSERVE_MSG` assertion (`tests/test_sandbox_watchdog.py:462`). It passed in both GREEN runs. This is the known pre-existing flake and was not caused by this step.
- Config-key wiring gate: not applicable (no config key, no migration).
- Files modified: `services/xstockstrat-indicators/tests/test_sandbox.py`, `services/xstockstrat-indicators/tests/test_sandbox_isolation.py`, `services/xstockstrat-indicators/tests/test_sandbox_watchdog.py`, `services/xstockstrat-indicators/tests/test_formulas.py`
- Deviations: RED run against the restored pre-Step-1 file; the existing fake moved to `:399`; E501 split (full detail in Deviation Log)

### Step 3 — service: boot self-test for `memory_used_bytes` in the startup probe [done]
- Moved the existing `run_startup_probe` body, unchanged, into `_run_memory_probe()`, so its early `return` no longer skips anything. Added `from app.services import sandbox`, `_UNMEASURABLE_MSG` and `_self_test()`. `_self_test()` calls `sandbox.execute_formula("result = {}", {}, [])` and logs INFO `sandbox memory self-test exit_reason=%s memory_measured=%d`. It logs ERROR on a non-success result or on memory <= 0. The new `run_startup_probe` runs the probe and then the self-test in its own `try`, and it never raises. `app/main.py` is unchanged.
- TDD (no `**Covers**`; Step 4 owns the tests):
  - RED came from a scratch behaviour probe outside the repo (`.sdd-logs/v-2.log`, exit=1). It covered a real run, a fake that returns 0 memory, and a fake that raises. It printed `real selftest: [] unmeasurable_errors: 0` and `FAILURES: ['real', 'zero', 'raises']`.
  - The pre-change Verification (`.sdd-logs/v-1.log`, exit=0) printed `625 passed`.
  - GREEN probe (`.sdd-logs/v-3.log`, exit=0) printed:
    - `real selftest: ['sandbox memory self-test exit_reason=success memory_measured=15691776'] unmeasurable_errors: 0`
    - `zero … unmeasurable_errors: 1`
    - `raises selftest: [] unmeasurable_errors: 1`
    - `FAILURES: []`
  - GREEN Verification (`.sdd-logs/v-4.log`, exit=0) printed `625 passed in 73.44s`, `Total coverage: 87.03%`, `All checks passed!`, `65 files already formatted`, `25:from app.services.sandbox_probe import run_startup_probe` and `46:    await asyncio.to_thread(run_startup_probe)`.
- The `test_ac8_fork_bomb…` flake did not appear in either Verification run.
- Config-key wiring gate: not applicable (no config key, no migration).
- Files modified: `services/xstockstrat-indicators/app/services/sandbox_probe.py`
- Deviations: RED evidence from a scratch probe; the run script puts the Verification's closing `)` on its own line (full detail in Deviation Log)
