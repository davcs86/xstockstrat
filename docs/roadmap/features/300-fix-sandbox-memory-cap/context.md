# Context: fix-sandbox-memory-cap  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: The sandbox memory cap is now enforced by the parent process. The DigitalOcean runtime evidently does not enforce the kernel `RLIMIT_DATA` (unconfirmed; probably gVisor-like).
- **Watchdog.** The parent polls the formula's process group every 50 ms. It arms on a handoff line the child writes before seccomp loads, and kills on VmData growth (R1) or absolute resident memory (R2).
- **Startup probe.** It logs whether the kernel enforces the cap and whether the watchdog can observe the child, and sets two gauges.
- **Homelab.** Got a 2g container limit as a second layer.

Launched 2026-11-10 (PR #1492).

The deciding question is still **UNANSWERED**: is DO's `/proc` readable enough for the watchdog to observe the child (O-3)? No staging probe line is recorded.

**Why (irrecoverable rationale)**:
- **Scope grew twice at the operator's request.** Recon showed two consumers (agent, UI), so design depth moved from quick to full. After round 1 the operator brought a container memory limit into scope as a second layer; it had been out of scope.
- **The container limit is only a second layer.** It cannot express "headroom above the baseline", so it would change 228 @AC-1/@AC-3. It kills the whole service and never reports `memory_exceeded`.
- **DO left unchanged on purpose.** `basic-s` (2 GB) is already the bound. Homelab got 2g to match it.
- **A `-9` is attributed only on evidence.** `RLIMIT_CPU` soft = hard also ends in SIGKILL, so "every -9 is memory_exceeded" would be wrong. A `-9` counts as `memory_exceeded` only if the watchdog killed the child or the cgroup `oom_kill` counter rose. `RLIMIT_CPU` and the 209 wording were left untouched to avoid a C-16 CHANGE.
- **Per-run fail-open when the parent cannot observe the child** (explicit operator sign-off). One ERROR per process. The formula still runs under `RLIMIT_DATA`, the timeout, the container limit and `oom_score_adj`.
- **Forked members count growth only.** The 209 fork-bomb scenario (@AC-5) keeps its current outcome.
- **The startup probe is non-fatal by operator choice.** A non-enforcing runtime is alertable (ERROR + gauge), not fail-closed.
  - On a non-enforcing runtime the probe deliberately touches 256 MiB once per boot (accepted).
  - A split verdict across the three legs counts as not enforced.
- **The post-deploy smoke is an operator-owned advisory follow-up.** Nothing in `/promote` or `/sdd-execute` enforces it (precedent: 209, 228).

**Rejected alternatives**:
- **Container limit as the main mechanism:** no baseline-plus-headroom semantics, kills the service, and gives no typed error.
- **Single VmData signal (round 1):** not runtime-independent. A runtime that ignores `RLIMIT_DATA` is also the likeliest to mis-track `data_vm`.
- **RssAnon growth trigger (round 2):** false-kills the 800×800 matmul on an enforcing kernel. Reserved-but-untouched memory moves from VmData to RssAnon, and the 8 MiB slack was invented. Replaced by the absolute R2 rule.
- **Daemon thread + lock + `pidfd_send_signal`:** unnecessary. A `communicate(timeout=tick)` loop in the calling thread is the only reaper, so the pid-reuse window cannot occur.
- **Arming from `/proc/<pid>/limits` or the first finite "Max data size":**
  - it mis-arms when the container passes down a finite limit;
  - a userspace kernel may fake the limits file;
  - an attacker can inflate `r0` by touching memory before the arming tick.
  
  Replaced by the handoff line the child writes before exec.
- **Firing "never armed" on every run:** a fast formula finishes inside one tick, so it would fire everywhere. It fires only on positive evidence.
- **Probe "observable" meaning "the fields exist":** it must mean the fields MOVE around a 16 MiB mmap+memset.
- **Watching only the leader:** a grandchild that forks and then allocates escapes, because `clone` is allowlisted.
- **Summing the full group including copy-on-write pages:** reclassifies the 209 fork-bomb.
- **`RLIMIT_AS` fallback:** breaks the INDICATORS-2 headroom semantics.
- **Per-child cgroup `memory.max`:** not writable on DO.
- **Monitor inside the child:** it runs in the attacker's process.
- **`RLIMIT_CPU` hard = soft+1:** touches the 209 setting and needs C-16 sign-off.
- **Sizing WARN / FR-4 / fault-rate measurement:** speculative (about 1–1.4 GiB against 2 GiB). Cut by the operator; AC-10 was retired and never reused.
- **Probe ERROR for "hard limit below baseline":** under-detects, and forces the probe to run after the config wait.
- **Resizing the DO instance:** no evidence that 2 GB is too small.

**Scars & gotchas**:
- **Native-kernel hole (hypothesised by the round-4 adversary, confirmed during execute).** With the watchdog off, a formula using only the default imports reaches `object.__subclasses__()` → `CDLL` → libc `mmap(MAP_SHARED)`. That formula, and a plain `mmap.mmap(-1, n)`, each allocate 400 MiB and SUCCEED under `RLIMIT_DATA` on Linux 6.18. So 209 @AC-3 was evadable off DO before 300, and only R2 closes it.
- **Test vs production Python versions differ.** The service venv is 3.12.3 but production runs 3.13. The sandbox suites were re-run with `UV_PYTHON=3.13`, and `mmap.resize` on an anonymous map was checked on both before relying on it.
- **The tick loop forced Steps 5 and 6 to land as one unit.** It turned the first-timeout assertion in `tests/test_sandbox.py` red, and the fake `Popen` lacked `returncode`. Fakes must:
  - set `returncode = None` up front;
  - patch the `_monotonic` alias, not the global `time`;
  - record the script only when `input is not None`.
- **compose v5.6.1 renders `mem_limit: 2g` as the string `"2147483648"`,** and an absent key as `"null"`. The render oracle compares via `tostring`.
- **CI only exercises the same-UID read path.** CI is non-root, so `_DROP_UID` does nothing there. The root-parent read of a uid-65534 child is validated only by the staging probe line.
- **Measured headroom margins on an enforcing kernel** (cap lifted, 64 MiB headroom). This is evidence, not proof:
  - 800×800 matmul: 23.3 MB VmData slack and 100.9 MB R2 slack;
  - 32 MiB array: 33.6 MB and 80.7 MB.
- **The `oom_kill` delta is container-wide,** because v2 `memory.events` is hierarchical. A concurrent run's OOM can therefore label another run's `-9` as `memory_exceeded`. This was accepted, and it is NOT documented in CLAUDE.md or INDICATORS-9.
- **`sandbox_probe.py` keeps its own `/sys/fs/cgroup` literals,** separate from `sandbox.py`'s `_OOM_EVENTS_PATH`, only because Step 3's Files excluded `sandbox.py`. This is not an oversight for a DRY pass to "fix" blindly.
- **This host has no readable cgroup v2 `memory.events`** (`oom_kill_readable=False`). The oom attribution path was unit-tested only.

**Permanent deviations**:
- **`_killpg` after reap.**
  - Design: the `returncode is None` guard "also makes the post-reap `finally` sweep real and closes findings :44".
  - Shipped: the guard is kept, the post-reap sweep remains a no-op, and that findings row stays open with corrected text.
  - Because: the two claims contradict each other; once `communicate()` has reaped the leader, the guard blocks the sweep. The operator chose G-2.
  - The "killpg on every exit" claim was withdrawn from indicators CLAUDE.md, but the `sandbox.py` module docstring still says it.
- **Handoff snippet.**
  - Design: it "catches nothing".
  - Shipped: no try/except, but fields are read with `.get(key, 0)`, so a missing `RssAnon`/`RssShmem` still gives a well-formed H1 line. VmData stays fail-closed through `_VMDATA_PROBE`.
  - Because: the shape is the approved round-5 proposal. The "departure" was a spec overreading and was withdrawn.
- **300↔304 merge order.**
  - Design: a soft merge-order row.
  - Shipped: a dated prose note in `merge-order.md`.
  - Because: a table row blocks the integration PR until the other feature launches, and the overlap is only textual.
- **DO doc drift.**
  - Design: fix `digitalocean.md:34,223,252,262`.
  - Shipped: only `:252` and `:262`, plus `infra-cost-reduction.md:18`.
  - Because: the other lines are generic size statements that don't name indicators.

**Cross-feature signal**:
- **Second time a sandbox isolation control looked fine on the CI kernel but was never checked on the runtime image** (209, then 300). The R2 finding shows even the native kernel was evadable, which 209's tests missed because they never used a `MAP_SHARED` path.
- **Triage kept this SEV-2 on Track C, not Track A,** because production exposure was only inferred. If DO is confirmed non-enforcing, memory isolation has never held on DO since 209. Pre-228 DO behaviour was never measured.
- **304 overlaps textually** on `sandbox.py`, `watcher.py`, the indicators CLAUDE.md and the shared tests. Whichever lands second rebases and re-greps its line anchors.

**Deferred follow-ons**:
- **Advisory post-deploy checklist (operator-owned, not yet run).** Record the results in this file. This checklist lived only in design.md.
  1. Copy the staging probe INFO line.
  2. If it reports observable, run the 400 MiB repro ONCE and expect `memory_exceeded` plus `executions{exit_reason="memory_exceeded"}` +1. Never escalate the allocation size.
  3. Run the 800×800 matmul and expect trace 641260.869, rank 50.
  4. If `observable=0`, record that FR-1 is fail-open on DO and reopen as SEV-2.
  5. Repeat step 1 on production.
  6. On homelab, `docker inspect` should show 2 GiB memory and 2 GiB swap, and the probe line should be logged.
- **Findings rows.**
  - The native-kernel exposure row in `services/xstockstrat-indicators/docs/context-constitution-findings.md` ("open — fix in 300") should be closed now that 300 has launched.
  - The post-reap sweep row (:44) stays open. A real sweep (an unguarded `killpg`, with a small pid-reuse risk) needs its own design decision.
- **Stale docstring.** The `sandbox.py` module docstring still says "killpg ... on every exit".
- **Sizing re-check.** Re-check the sizing formula whenever the live `sandbox.max_concurrent` or `sandbox.memory_bytes` changes.
- **Homelab unknowns.**
  - Is `memswap_limit` honoured without swap accounting?
  - Does the homelab-edge `app-deploy` gate accept `mem_limit`?
  - How much free RAM does the VM have?
- **Startup budget.** Homelab `start_period: 120s` must cover the 15 s probe, the 90 s config wait, the DB pool and seeding. DO's default health check for indicators is unverified.
- **Adjacent defects, out of scope:**
  - `memory_used_bytes` is always 0;
  - the stderr-substring classifier;
  - `RLIMIT_NPROC` is recomputed per call.

**Note:** the existing 300 ledger entries (insights 2026-11-09, fails 2026-11-09) cite design.md and context.md round gates. Those now resolve via `git show 2d91b5671335fcce267679b50caa494440205f51:<path>`.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-11-10 entries. The 2026-11-09 watchdog design insight and the runtime-only-fact fail already existed and were skipped.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **INDICATORS:** on any kernel, `MAP_SHARED|MAP_ANONYMOUS` and touch-then-`mprotect(PROT_READ)` memory is not counted in `data_vm`. `RLIMIT_DATA` alone never bounds sandbox memory, and formulas can reach `CDLL` via `object.__subclasses__()` with the default `allowed_imports`. Check INDICATORS-2/9 first; it may be a DUP.
- **PLAT (borderline):** compose v5.6.1 `config --format json` renders memory limits as byte strings.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. Defect report `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md` (pruned 2026-11-10; `git show 2d91b567:docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md`) (+ `.status`) was pruned in the same run.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-09 — impl-spec corrections after advisory review (operator decisions)

- Operator decisions: **G-1 = keep design, "catch nothing"** (no try/except in the child handoff snippet). **G-2 = keep the `_killpg` guard; findings row `:44` stays open.** **Merge-order = add an unconditional soft note.** **Next = fix the spec, then another review round (no execute yet).** No code has been written.
- G-1 resolution: design.md's snippet reads `VmData`/`RssAnon`/`RssShmem` with `.get(key, 0)`, so a missing `Rss*` line never raises; "catch nothing" and a tolerant child are the same design. The earlier "departure" in the spec was an overreading and is withdrawn. Step 1 now specifies the snippet verbatim without handlers; Step 2 adds the proving tests (all fields, `Rss*` absent, `open` raising propagates). A missing `VmData` stays fail-closed by `_VMDATA_PROBE` (228 `@AC-5`).
- G-2 resolution: guard kept; Step 5 states it does not close row `:44`; Step 11 rewrites row `:44` (stays open) and corrects the indicators `CLAUDE.md` "killpg ... every exit" bullet (`:148-149`).
- Merge-order: the operator asked for a "soft row". `merge-order.md`'s table gates a feature's final integration PR until the other is `launched` (file header), so a row would block 300 behind 304 (304 is `code-completed`, not launched). Implemented the intent (deterministic, non-blocking) as a **prose note**, the file's existing form for non-gating relationships (precedent: "Launch gate: 215 ↔ 283"). Flagged to the operator.
- Review items addressed in the spec: one `_first_time`/`_reset_once_flags` registry (Step 1) covers both once-flags, with an `oom_score_adj` test in Step 8 and no extra conftest scope (F-08); `h1_line` and `proc_status_text` are now conftest fixtures consumed by argument (C-13); Step 11 `**Files**` made deterministic; DO doc edits narrowed to the indicators mapping (`digitalocean.md:252,262`, `infra-cost-reduction.md:18`); "304 is a draft" corrected to `code-completed`; `_PROC` module constant added so group sampling and `oom_score_adj` are testable against a synthetic tree.
- Not changed (acceptable, noted): Step 11 still touches six files (advisory >5, not a rule); the AC-4 false-kill margin is recorded not asserted (design open risk).

_From: Session 2026-11-09 — sdd-design Phase 1 round 2 gate_

- Operator decisions at the gate: **Run round 3**. Smoke gate = **honest owned follow-up** (advisory, owner = operator; no /promote change). DO = **no spec change** (basic-s 2 GB per docs/runbooks/infra-cost-reduction.md; homelab gets explicit mem_limit/memswap_limit 2g by parity; fix the basic-xs doc drift in docs/setup/digitalocean.md:252 and infra-cost-reduction.md:18; the FR-2 probe logs memory.max). SIGKILL attribution = **evidence-based via cgroup memory.events oom_kill delta**, else runtime_error 'killed by signal 9'; RLIMIT_CPU and 209 wording untouched (no C-16 CHANGE).
