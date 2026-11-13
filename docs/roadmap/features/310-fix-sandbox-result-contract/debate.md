# Debate Register: fix-sandbox-result-contract

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 6 | 5 | 0 | 8 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 5 | 4 | 3 | 2 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 3 | 3 | 3 | 0 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Failure class is carried by a per-run nonce (secrets.token_hex(16)) status line on the child's stdout, emitted by the wrapper's exception-type handler chain (_ImportBlocked / MemoryError / BaseException) around exec and json.dumps, followed by a bare re-raise. No second pass_fds pipe. | sandbox.py:562,647,651,802-805; tests/test_sandbox_watchdog.py:148-180 (one-descriptor scope); both sides agree in r1 | settled |
| D-2 | 1 | The 'is not allowed in sandbox' stderr substring test is deleted. The _MEMORY_EXHAUSTED_MARKERS stderr check is kept only as the no-status-line fallback (classifier step 4), after the -SIGKILL + _oom_kill_rose step. | sandbox.py:544,809,811,813; tests/test_sandbox_isolation.py:225-239 (feature-228 @AC-4 fake emits no status) | settled |
| D-3 | 1 | Missing result is detected in the wrapper by key presence ('result' not in _formula_globals). The wrapper then emits _status('no_result') and no __OUTPUT__ marker, and the parent fails with runtime_error 'formula did not assign result' before the feature-268 checks. `result = {}` still succeeds. | sandbox.py:651,821-826 | settled |
| D-4 | 1 | A status line is not required for success; the parsed __OUTPUT__ marker remains the positive artifact. | tests/test_sandbox_isolation.py:65; tests/test_sandbox.py:237,274 | settled |
| D-5 | 1 | The status line is stripped from stdout before both the _fail path and the success return; the nonce never reaches SandboxResult.stdout. | sandbox.py:787-797; services/xstockstrat-ui FormulaRunResult.tsx:92-98 renders stdout | settled |
| D-6 | 1 | _status is total (body wrapped in try/except BaseException: pass) and must never raise or replace the in-flight exception. | adversary r1 robustness objection; MemoryError handler runs while traceback frames still hold allocations | settled |
| D-7 | 2 | returncode != 0 classifier order: (1) status import_blocked or memory_exceeded; (2) -SIGKILL and _oom_kill_rose → memory_exceeded; (3) any other status → runtime_error; (4) no status and a _MEMORY_EXHAUSTED_MARKERS stderr hit → memory_exceeded; (5) runtime_error. | sandbox.py:807-814 (current), :813 counter evidence; 300@AC-5; insights 2026-11-04; adversary r2 | settled |
| D-8 | 2 | indicators.proto is not edited. The memory_used_bytes definition is documented in the service CLAUDE.md § Sandbox Security Model and the agent test_formula docstring only. | indicators.proto:95 field 6 has no comment; proto-freshness gate regenerates packages/proto/gen; adversary r2 C-09 | settled |
| D-9 | 2 | acceptance.feature @AC-2 is rewritten to the two-run form: A = `result = {}`, B = numpy.ones(10_000_000) touched; B−A ≥ 40 MiB and A > 0. It is mirrored by a real-subprocess RED test run through the service venv. | acceptance.feature:14-18 (numpy.zeros > 0, absolute); R-5; numpy.ones 80,000,000 B ≈ 76.3 MiB margin | settled |
| D-10 | 2 | The feature-300 startup sandbox memory probe gains a VmHWM-presence leg and logs ERROR once when the line is absent. The dev two-run smoke is advisory only. memory_used_bytes has no VmRSS fallback. | ledger fails 2026-11-09 (non-owner post-deploy smoke); service CLAUDE.md § Memory watchdog (DO not a native kernel); R-2 | settled |
| D-11 | 2 | _split_status removes the matched status line and the one injected newline before it, so SandboxResult.stdout is byte-identical to the formula's own output. | proposal r2 print("\n__STATUS__..."); FormulaRunResult.tsx:92-98; D-5 | settled |
| D-12 | 3 | D-10's startup ERROR leg is realised as a boot self-test. run_startup_probe calls sandbox.execute_formula("result = {}", {}, []) with the function's defaults, in its own try/except and independent of _probe() success. It logs INFO 'sandbox memory self-test exit_reason=%s memory_measured=%d', and logs ERROR 'sandbox memory_used_bytes unmeasurable on this runtime' when exit_reason != success, when memory <= 0, or when it raises. There is no per-run ERROR, no presence-only leg and no new gauge. | sandbox_probe.py:48-103 (probe child has no seccomp), :201-236, :309-320; sandbox.py:670-679 defaults; tests/test_sandbox_probe.py:89,93-98; main.py:46; ledger fails 2026-11-09; adversary r3 | settled |
| D-13 | 3 | The promoted @AC-2 gives run B's formula source as a Gherkin DocString and begins with a runtime precondition Given 'the runtime renders a VmHWM line in /proc/self/status'. | Gherkin step text has no escapes; C-16 promotion fidelity; acceptance.feature:14-18; adversary r3 | settled |
| D-14 | 3 | context-constitution-findings.md:23 and the report-2 sidecar are marked resolved only conditionally ('where the boot self-test logs memory_measured>0; DO confirmation pending the first post-deploy boot log'). The /sdd-execute integration PR author records that boot log line in context.md at promotion. | ledger fails 2026-11-10 (closes a findings row); proposal r3 strongest-risk; adversary r3 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Child-side getrusage(RUSAGE_SELF) ru_maxrss as the memory_used_bytes source (and adding getrusage to _SECCOMP_ALLOW) | rusage is preserved across execve and exec folds the spawner's (vfork: the server's) mm high-water into signal->maxrss, so the value includes the parent's peak RSS | locked |
| R-2 | 1 | Reporting max(child RSS figure, watchdog peak_resident) in memory_used_bytes | mixes leader total RSS with group anon+shmem that exists only when the watchdog is armed; one field would mean different things on different paths | locked |
| R-3 | 1 | Second pass_fds pipe as the status channel | breaks feature-300 descriptor-scope tests (test_sandbox_watchdog.py:148-180) and is no harder to forge post-exec | locked |
| R-4 | 1 | Distinct exit codes per failure class | collide with SystemExit(n)/os._exit(n)/C-level abort exit 1 and cannot carry the memory figure | locked |
| R-5 | 1 | Absolute-threshold-only memory RED test | cannot tell a correct measurement from an inherited or baseline figure; a two-run discriminating comparison is required | locked |
| R-6 | 2 | Classifier with 'any status → runtime_error' ahead of the -SIGKILL + oom-rise step | demotes kernel OOM counter evidence for runs OOM-killed after _status, regressing 300@AC-5 | locked |
| R-7 | 2 | VmRSS fallback when VmHWM is absent | field would mean peak on one path and current on another (R-2 spirit); absence is surfaced by the startup-probe ERROR instead | locked |
| R-8 | 2 | Field comment on indicators.proto:95 for the memory definition | triggers stub regeneration under proto-freshness and proto governance for documentation that the service CLAUDE.md and the agent docstring carry | locked |
| R-9 | 2 | AC-2 two-run threshold of 70 MiB | about 6 MiB of margin against high-water import transients makes it flaky; 40 MiB still discriminates | locked |
| R-10 | 3 | Startup VmHWM-presence leg reading the probe child's /proc status | the probe child loads no seccomp and never does the _ms lseek/read, so it checks only that the field exists (ledger fails 2026-11-09); it also duplicates the _try_sample read (C-18) | locked |
| R-11 | 3 | Per-run once-per-process ERROR when a status-bearing run measures 0 | user-triggerable and latched (close or zero _ms); fires only after the first user run; false ERROR on a MemoryError status run; cannot separate a runtime defect from user action | locked |
| R-12 | 3 | Per-run label-free memory_measured gauge | any formula drives it to 0 on its own run, so it flaps; it adds a per-run telemetry write for a one-time runtime fact | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | memory_used_bytes definition undefined. Operator must choose total leader peak RSS or peak growth above the pre-exec baseline (recommended), and what no-status paths report. Record it in the proto comment and the service CLAUDE.md. | yes | open |
| O-2 | 1 | VmHWM-via-pre-seccomp-fd memory source depends on runtime-only facts (post-UID-drop /proc readability, lseek/read under the filter on the DO kernel). It needs a named owner, a check on the runtime image, and a discriminating two-run real-subprocess RED test. | yes | closed @ round 3 (Boot self-test runs the real wrapper (setuid, seccomp, _ms read, status parse) on the runtime kernel inside run_startup_probe before user code and logs ERROR on memory<=0. The discriminating two-run real-subprocess RED test is D-9. The DO confirmation is owned via the conditional findings marking and the first boot log recorded at promotion.) |
| O-3 | 1 | OQ3 ruling (stderr substring classification is not a fixed contract) must be recorded in context.md before the docs/context-constitution.md:41 edit. | yes | open |
| O-4 | 1 | Operator must explicitly accept the self-forgery residual for the forger's own run (frame traversal, raise MemoryError, stderr 'MemoryError' + os._exit(1)). | yes | open |
| O-5 | 1 | C-14: deferring the /insights memory display needs explicit operator sign-off recorded in context.md. | no | open |
| O-6 | 1 | Agent test_formula docstring (tools.py:1687-1689) must list memory_used_bytes with its meaning; the field is already returned via MessageToDict (client.py:1178-1180). | no | closed @ round 2 (Proposal r2 adds memory_used_bytes and its definition to the test_formula docstring (tools.py:1687-1689); the field is already returned (client.py:1178-1180).) |
| O-7 | 1 | Declared-output 'did not assign result' wording change must be recorded in design.md as deliberate. | no | closed @ round 2 (Proposal r2 records the declared-output 'formula did not assign result' wording as deliberate: still runtime_error, and no scenario pins the old text.) |
| O-8 | 1 | Wrapper try/_status block and five-step classifier must appear verbatim in design.md (ledger fails 2026-11-09/10). | no | closed @ round 2 (Wrapper block and classifier are given verbatim. The classifier text to paste into design.md is the corrected order in this synthesis.) |
| O-9 | 2 | acceptance.feature @AC-2 must be rewritten to the two-run discriminating form before /sdd-spec so the promoted rule matches the RED test. | no | closed @ round 3 (Verbatim @AC-2 replacement given in DocString form with the runtime precondition Given and the 41943040-byte (40 MiB) two-run threshold.) |
| O-10 | 2 | Service CLAUDE.md and agent docstring must state that memory_used_bytes includes the baseline, that memory_exceeded and other no-status outcomes normally report 0 ('not measured'), and that grandchildren are not counted. | no | closed @ round 3 (Verbatim definition text (baseline included, 0 = not measured on timeout/watchdog kill/signal/abort/os._exit so most memory_exceeded report 0, grandchildren not counted) for the service CLAUDE.md, condensed into the agent test_formula docstring.) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
