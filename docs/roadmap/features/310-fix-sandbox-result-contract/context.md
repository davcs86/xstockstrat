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
