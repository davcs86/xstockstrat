# Design: fix-sandbox-memory-cap

**Created**: 2026-11-09
**Rounds**: 5 (full; termination: approved at the hard cap)
**Approved by**: user @ 2026-11-09 (final gate, round 5; decisions recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

Two parent-side mechanisms inside `xstockstrat-indicators`, plus a homelab container limit. No proto, DB or config-key change; the five jail constants below are build-time constants, not config (209 `@AC-6`, F-07).

### 1. FR-1 — per-run memory watchdog in `execute_formula` (`app/services/sandbox.py`)

Active only when `memory_bytes > 0`. Runs in the calling worker thread; no extra thread, lock or pidfd.

- **Loop.** The single `proc.communicate(input=wrapped, timeout=deadline)` (`sandbox.py:380`) becomes a loop of `communicate(input=wrapped if first else None, timeout=min(_TICK_S, remaining))`, `_TICK_S = 0.05`. The deadline is absolute on a module alias `_monotonic = time.monotonic`, so wall time, the timeout path (`:381-393`) and the 295 deadline clamp (`servicer.py:321-337`) are unchanged. `communicate` is the only reaper, so every sample and kill happens while the leader is unreaped (a zombie still holds its pid and pgid), which removes the pid-reuse window by construction.
- **Arming by child-reported handoff.** Before `Popen` the parent creates `r, w = os.pipe()` and passes `w` with `pass_fds=(w,)`; it closes `w` right after `Popen` (and in an `except`), sets `r` non-blocking, and closes `r` in a `try/finally` that also covers a raising `Popen`. A new wrapper snippet `_HANDOFF` is inserted directly after the `RLIMIT_DATA` block (`:281-283`) and before CPU/NPROC/FSIZE/NOFILE (`:284-287`), `json.loads` (`:290`) and the seccomp `.load()` (`:301`). It reads `/proc/self/status` (`VmData`, `RssAnon`, `RssShmem`) and `getrlimit(RLIMIT_DATA)[0]` / `getrlimit(RLIMIT_STACK)[0]`, writes one line `H1 <cap> <r0> <stack>\n` (r0 = `RssAnon + RssShmem - VmData`) with `os.write`, and closes the fd before `exec`. The template emits the two-character `\n` escape (not a raw newline). Pre-seccomp `open` and `prlimit64` are legal; `os` and `resource` are already imported in the wrapper. The snippet catches nothing: a failure crashes the child before `exec` and classifies through the existing path. With `memory_bytes <= 0` the snippet, the pipe and `pass_fds` are all omitted.
- **Parent handoff states** (bounded read, `_HANDOFF_MAX = 128`, first complete line only): PENDING (no sampling), ARMED, ABSENT (EOF/exit with no line: the formula never ran; no record, existing classification, keeps 228 `@AC-5` and the "fast formula" case silent), MALFORMED (not exactly `H1 <int> <int> <int>`, no `\n` within the bound, or `base <= 0`: one ERROR `sandbox memory watchdog cannot observe child`, fail-open for this run).
- **Seam-safe base.** `hr = _child_headroom(memory_bytes)` is computed once per run (identity in production; a documented test seam). It formats the child's cap line and is the subtrahend: `base = cap - hr`. Both thresholds use the real `memory_bytes`. A unit test pins that `base` is identical with the seam on and off (seam value `2**40` so the `min(..., 2**63-1)` clamp at `:282` never bites).
- **Group sample.** Each tick after arming: list `/proc`, keep pids whose `stat` pgrp (token index 2 after the last `)`) equals `proc.pid`; per member read `stat`/`status` relative to a `/proc/<pid>` dirfd. State (token 0) `Z`/`X` contributes 0, emits nothing and is never evidence of "cannot observe". `FileNotFoundError`/`ProcessLookupError` contribute 0, silently. Cannot-observe evidence is only `PermissionError`, or a running member with neither `VmData` nor `RssAnon`.
- **Rules** (strict `>`):
  - **R1** — group VmData growth `> memory_bytes`. Leader: `VmData - base`. Non-leader member (keyed `(pid, starttime)`, starttime = token 19): `max(0, VmData - ref)`, `ref` = its own VmData at first sight (growth-only, so a COW fork child counts about 0 and 209 `@AC-5` keeps its classification).
  - **R2** — group resident `Σ(RssAnon + RssShmem)` over non-zombie members `> base + memory_bytes + max(r0, 0) + stack_term`, `stack_term` = the reported stack soft limit if finite, 0 for `RLIM_INFINITY`. R2 is what makes FR-1 runtime-independent: it catches `MAP_SHARED|MAP_ANONYMOUS` and touch-then-`mprotect(PROT_READ)` memory (outside `data_vm` on any kernel) and a runtime whose `VmData` is coarse. If only `RssAnon` is missing, R2 is skipped for the run and R1 continues, silently; if only `VmData` is missing, R1 is skipped and R2 continues.
- **Kill.** On breach set `killed_by_watchdog`, `os.killpg(proc.pid, SIGKILL)` (only while `proc.returncode is None`; `_killpg` body becomes this, which also makes the post-reap `finally` sweep real and closes `context-constitution-findings.md:44`), then `communicate()` reaps.
- **Classification order** (before the stderr logic at `:409-427`): (1) `killed_by_watchdog` → `memory_exceeded`; (2) timeout (unchanged); (3) `returncode != 0`: import-blocked, stderr markers, then `-9` with a cgroup-v2 `memory.events` `oom_kill` delta `> 0` (read before `Popen`, after reap) → `memory_exceeded`; otherwise the existing "formula exited with code -9 before producing output" text with `exit_reason=runtime_error` (error text unchanged, only the attribution is new — 268 and `docs/runbooks/indicator-builder.md` wording preserved). An unreadable counter → `runtime_error`.
- **`oom_score_adj`.** The parent writes `1000` to `/proc/<pid>/oom_score_adj` right after `Popen` (child still root); `FileNotFoundError` silent (fake pids), other failures WARN once per process. In a cgroup OOM the largest child dies rather than the gRPC server; this can make a legitimate concurrent formula the victim, which is documented.
- **Observability.** One once-per-process flag (shared with the probe) for the "cannot observe" ERROR; a DEBUG `sandbox watchdog peak` record (`peak_vmdata_growth`, `peak_resident`) gives recorded peaks, not a proof.
- **Documented residuals** (FR-1 wording, INDICATORS-2/9): (a) an over-headroom burst that allocates and frees, or exits, within one 50 ms tick is not reported; (b) inflate-fork-deflate is bounded by about `NPROC × (base + 2H)`, parity with native per-process `RLIMIT_DATA`; (c) per-run fail-open when the parent cannot observe (operator sign-off, context.md round-4 gate); (d) fork-bomb runs may now end `memory_exceeded` through R2 (still a typed error, but visible in the `memory_exceeded` metric/WARN); (e) "R1/R2 cannot fire before `RLIMIT_DATA` on an enforcing kernel" is an empirical claim backed by recorded peaks, not a proof.

### 2. FR-2 — startup probe (`app/services/sandbox_probe.py`, new)

`run_startup_probe()` never raises (non-fatal like `seed_default_formulas`, `main.py:62`). `serve()` calls it as `await asyncio.to_thread(run_startup_probe)` right after `init_telemetry()` (`main.py:43`), before the config wait, so the runtime fingerprint is logged even when config is unreachable. The probe uses the 64 MiB code constant and reads no config; there is no "hard limit below baseline" ERROR (a finite inherited hard limit already fails every run visibly as `runtime_error`; the inherited `RLIMIT_DATA` is logged as an INFO field).

- **Child** (`[sys.executable, "-c", _PROBE_SCRIPT]`, `stdin=PIPE`, `stdout=PIPE`, `stderr=DEVNULL`, `pass_fds=(w,)`, `env=_sandbox_env()`, `start_new_session=True`; no seccomp, no untrusted code): shared `_DROP_UID` (so the root parent reads a uid-65534 `/proc` as in production) and `_VMDATA_PROBE`; sets `RLIMIT_DATA = baseline + _child_headroom(64 MiB)`; runs the same `_HANDOFF` snippet and prints `set <cap>`.
- **Step A (observable):** child prints `s0`, parent samples; child maps and writes 16 MiB `MAP_PRIVATE` (pages land in `RssAnon`), prints `s1`, parent samples.
- **Step B (enforced), three legs at 256 MiB, each mapping closed before the next:** `mmap.mmap(-1, n, flags=MAP_PRIVATE)`; `mmap.mmap(-1, 16 MiB, flags=MAP_PRIVATE).resize(n)` (the real `mremap`); the literal numpy repro `np.zeros(1).resize(..., refcheck=False)`. A leg is refused only on `MemoryError` or `OSError` with `ENOMEM`; any other exception → probe failed. `enforced` = all three refused; a split counts as not enforced.
- **I/O:** `selectors.DefaultSelector` (not `select.select`) + `os.read` on raw fds with a private line buffer, under `_PROBE_TIMEOUT_S = 15`; on timeout `os.killpg` + reap.
- **Verdicts:** `observable` = well-formed handoff AND `cap_read == cap_set` AND `VmData` moved ≥ `_PROBE_MOVE_MIN` (8 MiB) between s0 and s1 AND no `PermissionError`. `rssanon_delta` is logged separately (`r2_viable`); gauge 0 means "R1 blind".
- **Output:** one INFO `sandbox memory probe` line (uname fields, `/proc/version`, cgroup `memory.max` v2 or v1 or `absent`, `rlimit_data_hard`, `cap_set`, `cap_read`, `vmdata_delta`, `rssanon_delta`, `probe_rss`, `oom_score_adj` read-back, `oom_kill_readable`, the three refused flags, `enforced`, `observable`). ERROR `sandbox memory cap not kernel-enforced` when not enforced; ERROR `sandbox memory watchdog cannot observe child` when not observable (sets the shared once-flag); ERROR `sandbox memory probe failed` on timeout, crash, missing/malformed line or unexpected exception (both gauges then 0). Gauges `indicators.sandbox.memory_cap_enforced` and `indicators.sandbox.memory_watchdog_observable` (0/1, no labels) reuse the `snapshot_age` pattern (`telemetry.py:352-365,390-395`). The service always keeps serving.
- On a non-enforcing runtime the numpy leg briefly touches 256 MiB once at startup (accepted).

### 3. FR-3 — homelab container limit

`deploy/homelab/compose.yml:159-176` indicators gets `mem_limit: 2g` and `memswap_limit: 2g` (parity with DO `basic-s`, 2 GB per `docs/runbooks/infra-cost-reduction.md:15`; derivation: memory budget `parent + max_concurrent × (baseline + memory_bytes + overshoot)` at defaults is about 1-1.4 GiB). `deploy/homelab/render-assert.jq` projects `mem`/`swap` via `tostring` in `project` (`:14-22`) and emits only the label `mem-limit:xstockstrat-indicators` when either differs from `"2147483648"` (no value printed); `scripts/homelab-render.test.sh` adds delete and set-to-1g mutations beside `:146-165`. DO spec unchanged. Doc drift fixed in `docs/setup/digitalocean.md:34,223,252,262` and `docs/runbooks/infra-cost-reduction.md:18` (indicators is `basic-s` in `.do/app.yaml:197` and `.do/app.dev.yaml:197`). The sizing formula goes in indicators `CLAUDE.md`; re-checking it on live `max_concurrent`/`memory_bytes` changes is an owned follow-up (no sizing WARN: cut by the operator).

### Consumer surfaces (C-14)

Agent `test_formula`/formula tools and UI `/insights` formula test runs: no code change. `exit_reason` simply becomes `memory_exceeded` where the runtime previously returned success; the existing servicer map (`servicer.py:362-368`), counter and WARN carry it.

### Test seam and tests

`_child_headroom` is the only seam (identity in production; documented as a test seam; patching it to `2**40` lifts the kernel cap while the watchdog enforces the real headroom, emulating a non-enforcing kernel on CI). The watchdog and probe tests drive real children. Fake-Popen hazards (all folded into the steps): fakes define `returncode = None` up front; `_fake_popen` records `wrapped` only when `input is not None` and stores `kwargs`; a handoff-path test fake writes an `H1 …` line (or garbage) to `pass_fds[0]` and raises `TimeoutExpired` at least once; patch the `_monotonic` alias, never the global `time`; a conftest fixture resets the once-flags; `FileNotFoundError` for fake pids stays silent.

## Rejected Alternatives

- Container memory limit as the FR-1 mechanism — cannot express headroom-above-baseline (flips 228 `@AC-1`/`@AC-3` to CHANGE), kills the whole service, reports no `memory_exceeded`. Kept only as defence in depth (FR-3).
- Single `VmData` signal with no fallback (round 1) — not runtime-independent; a runtime that ignores `RLIMIT_DATA` is the likeliest to mis-track `data_vm`.
- RssAnon-growth trigger (round 2) — false-kills the 800×800 matmul on an enforcing kernel (reserved-but-untouched memory moves VmData→RssAnon); replaced by the absolute R2.
- Daemon thread + lock + `pidfd_send_signal` — avoidable complexity; the calling-thread `communicate(timeout)` loop removes the pid-reuse window by construction.
- Baseline via `/proc/<pid>/limits` polling — mis-arms on an inherited finite limit, depends on limits-file fidelity, and the `r0` sample is attacker-influenced; replaced by the child-reported handoff on trusted pre-exec data.
- Leader-only watchdog — a fork-then-allocate grandchild escapes on a non-enforcing kernel (`clone` is allowlisted).
- Full group sum counting copy-on-write pages repeatedly — would reclassify the 209 fork-bomb; replaced by growth-only counting.
- `RLIMIT_AS` fallback — breaks INDICATORS-2 headroom semantics; would flip 228 `@AC-1`/`@AC-3` to CHANGE.
- Per-child cgroup `memory.max` — not writable on DO; fails the "both runtimes" constraint.
- Child-side self-monitor — runs inside the attacker's process and can be disabled.
- "Any `-9` is `memory_exceeded`" — wrong: `RLIMIT_CPU` soft=hard ends in SIGKILL; attribution is by `oom_kill` delta.
- `RLIMIT_CPU` hard = soft+1 — touches the 209 setting/wording (needs C-16 sign-off); not needed.
- Sizing WARN / FR-4 / fault-rate measurement — speculative at defaults (about 1-1.4 GiB vs 2 GiB); cut by the operator; owned follow-up.
- Probe "hard limit below baseline" ERROR — under-detects (probe baseline is lower than the formula's) and forced the probe after the config wait; cut.
- Enforcing the post-deploy smoke via `/promote` or `/sdd-execute` — outside this bug's scope; honest owned advisory checklist instead.
- Resizing DO indicators — no evidence `basic-s` (2 GB) is too small.

## Open Risks

- [ ] **DO `/proc` fidelity (strongest risk).** If DO's runtime lacks or does not move `VmData`/`RssAnon` for a cross-UID child, FR-1 is fail-open there and only the 2 GB container limit plus `oom_score_adj` bound memory. Decided by the first staging probe line; CI cannot disprove it. — advisory checklist step 1/4, post-deploy.
- [ ] **Per-run fail-open when the parent cannot observe** (operator-accepted). — INDICATORS-2/9 and FR-1 wording at the docs step.
- [ ] **Burst inside one 50 ms tick is unreported**; the AC-1 regression holds the allocation, the literal one-shot repro lives on the staging checklist. — docs step, checklist.
- [ ] **Inflate-fork-deflate** is bounded by about `NPROC × (base + 2H)`; fork-bombs may surface as `memory_exceeded`. — docs step.
- [ ] **R2 near-cap false-kill margin on an enforcing kernel** (resident memory not counted in VmData: RELRO, resident stack). Record the AC-4 peaks and the per-run slack in context.md at execute. — watchdog step.
- [ ] **`oom_kill` delta can mislabel a concurrent run's `-9`**; `memory.events` is hierarchical on v2; unreadable counter falls back to `runtime_error`. — docs step.
- [ ] **`mmap.resize()` on anonymous maps with CPython 3.13 unverified**; a non-ENOMEM error makes the probe report "failed" and AC-3 red on CI before deploy. — probe step.
- [ ] **Native-kernel exposure:** a formula reaches `CDLL` via `object.__subclasses__()` (ctypes imported at `sandbox.py:206`) and can `mmap(MAP_SHARED)` outside `data_vm`, so 209 `@AC-3` is already evadable off-DO. Findings row in `services/xstockstrat-indicators/docs/context-constitution-findings.md` marked "open — fix in 300" until launch. — docs step; closed by AC-11.
- [ ] **CI exercises the same-UID read path only** (non-root, `_DROP_UID` is a no-op); the root→65534 path is validated by the staging probe line. — checklist.
- [ ] **Homelab:** whether `memswap_limit` is honoured without swap accounting; whether the external homelab-edge `app-deploy` gate accepts `mem_limit` (not visible from this repo); the homelab VM's free RAM. — checklist item 6.
- [ ] **Startup budget:** homelab `start_period: 120s` (+6×5 s retries, `compose.yml:24-29`) must cover WAIT_FOR + the 15 s probe + the 90 s config wait + DB pool + seeding; DO has no explicit `health_check` for indicators (default unverified). Update the `:24` comment. — homelab step.
- [ ] **Soft overlap with draft 304** on `sandbox.py` (docstring, `RLIMIT_DATA` block) and `watcher.py`; 300 adds no key literal. Soft merge-order row; whichever lands second rebases. — docs step.
- [ ] **Owned advisory post-deploy checklist (owner: operator, non-gating, record in context.md):** (1) after the first staging deploy copy the probe INFO line (runtime, kernel, `memory.max`, both gauges, deltas) — answers O-3; (2) if observable: run the 400 MiB repro once (no escalation), expect `memory_exceeded` and `executions{exit_reason="memory_exceeded"}` +1; (3) run the 800×800 matmul, expect trace 641260.869 rank 50; (4) if observable=0 record that FR-1 is fail-open on DO and escalate (reopen SEV-2); (5) repeat step 1 on production after promotion; (6) homelab: `docker inspect` shows 2 GiB memory and swap and the probe line is logged. Nothing enforces this (no `/sdd-execute` post-deploy step; `/promote` has only a manual checkbox): fails.md 2026-10-07 and 228 `context.md:57` are the precedent.

## Constitution Rules Touched

- `C-01`/`F-04` — honored: every path and symbol cited in recon.md came from validated digests; the unverified items (DO kernel, `mmap.resize` on 3.13, numpy/pandas attribute reachability) are listed as risks, not guessed.
- `C-02`/`P-05` — honored: context.md was read at boot and appended after every round gate and operator decision.
- `C-05`/`F-07` — honored: no config key added; `_TICK_S`, `_HANDOFF_MAX`, `_PROBE_TIMEOUT_S`, `_PROBE_MOVE_MIN`, the 16/64/256 MiB probe sizes and `oom_score_adj` 1000 are fixed jail constants documented as such (209 `@AC-6` wording, `indicators-sandbox-os-isolation.feature:46-51`); thresholds derive from the config `memory_bytes`; the homelab `2g` is deploy config, not a `WatchConfig` value.
- `C-08` — honored by paired tests per step (watchdog, probe, telemetry, render-assert mutations) meeting the service's coverage threshold.
- `C-10` — the shared-surface seam is the exit_reason path (servicer map, counter, WARN) and the two deploy descriptions: no duplicated instance needs updating; DO and homelab docs fixed in the same change.
- `C-11` — honored: story → review → design (full) before any code.
- `C-13` — new domain literals (handoff lines, `/proc` status text) live in `tests/conftest.py` once a second test consumes them.
- `C-14` — honored: Agent `test_formula` and UI `/insights` named; no stale surface, no shape change.
- `C-15` — honored: `acceptance.feature` is the single source (AC-1..AC-14); each scenario maps to a RED/guard assertion; IDs append-only (AC-10 retired and never reused).
- `C-16` — honored: no CHANGE; headroom semantics, seccomp allowlist, UID drop, NPROC/FSIZE, `RLIMIT_CPU`, the `-9` error text and the 209 wording are untouched.
- `C-18` — honored: stdlib only; one new module; each mechanism traces to a debate finding; the sizing WARN, hard-limit ERROR, thread/lock/pidfd stack and fault-rate measurement were cut. Proportionality ceiling reached: no further heuristics at `/sdd-spec`.
- `P-01`/`P-02`/`P-04` — honored: the orchestrator mediated every proposer/adversary exchange and the operator approved at each round gate.
- `P-03` — honored: no silent deviation; fail-open, residuals and the unverified DO behaviour are explicit and signed off.
- `P-06` — honored: AC-4 and AC-8 are labelled regression guards; the other ACs have honest RED reasons (AC-1's RED is the missing seam/behaviour, with an assertion that the watchdog, not the kernel, did the kill).
- `F-01`..`F-03`, `F-05`, `F-06`, `F-08`..`F-10` — not touched (no migration, no DB pool change; execution rules apply at `/sdd-execute`).
- `F-11` — honored: the adversary reported no Floor breach in any of the five rounds.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @FR-1 @feature-228` "The 800x800 matmul fits within half the default headroom" (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature`) — not regressed by: absolute R2 and growth rules; shown, not asserted, by feature AC-4's recorded peaks.
- PRESERVE `@AC-2 @FR-2 @feature-228` "An allocation beyond the headroom fails closed" (same file) — identical `memory_exceeded` on an enforcing kernel (the watchdog never fires first).
- PRESERVE `@AC-3 @FR-1 @feature-228` (same file) — `base` is the child's measured baseline (`cap - hr`), so headroom stays above the pre-lockdown baseline.
- PRESERVE `@AC-4 @FR-2 @feature-228` (same file) — the OpenBLAS stderr classifier stays after the watchdog flag.
- PRESERVE `@AC-5 @FR-3 @feature-228` (same file) — ABSENT handoff = existing `runtime_error`, no "cannot observe" record; the child baseline probe stays fail-closed and distinct from the parent probe.
- EXTEND `@AC-3 @FR-3 @feature-209` (`indicators-sandbox-os-isolation.feature`) — adds a runtime-independent kill; its stale "address-space"/"at its RLIMIT" wording is not hand-edited (C-16).
- PRESERVE `@AC-1 @FR-1 @FR-2`, `@AC-2 @FR-2`, `@AC-4 @FR-4`, `@AC-5 @FR-3`, `@AC-6 @FR-5` `@feature-209` (same file) — seccomp allowlist and UID drop unchanged; `/proc` inspection stays parent-side; NPROC untouched (no new thread); fork-bomb remains a typed error (may now read `memory_exceeded`); constants documented.
- PRESERVE `@AC-5 @FR-5 @feature-176` (`analysis-concurrency-offload.feature`) — per-call loop in each worker; concurrent runs not serialized.
- PRESERVE `@AC-6 @FR-7`, `@AC-18 @FR-12`, `@AC-38 @FR-12` `@feature-295` (`fix-config-keys-drift.feature`) — absolute deadline in the loop; timeout and clamp ordering unchanged.
- EXTEND `@AC-37 @FR-12 @feature-294` (`signal-map-instrumentation.feature`) — a watchdog kill is counted as `memory_exceeded`; the two gauges are additive.
- PRESERVE `@AC-1 @FR-1`, `@AC-2 @FR-1` `@feature-268` — a SIGKILLed child never falls to "produced no output"; the `-9` error text is unchanged.
- PRESERVE `@AC-1`/`@AC-3 @feature-243`, `@AC-6 @FR-3 @feature-244` — `memory_bytes` seed, default handling and row description untouched.
- PRESERVE `@AC-41`/`@AC-42 @FR-15 @feature-294`, `@AC-8`/`@AC-17 @FR-6 @feature-274` (`platform.feature`) — gauges carry no labels; telemetry is a no-op when disabled; no alert/dashboard added.
- EXTEND `@AC-29`, `@AC-35`, `@AC-36`, `@AC-43 @feature-279` (`platform.feature:1235-1239,1262-1292`) — a new render-assert label; output stays labels-only, an empty render never passes, no value printed.
- PRESERVE `@AC-5 @FR-5 @feature-205` (`services/xstockstrat-agent/acceptance/formula-fundamental-inputs-authoring.feature`) — `test_formula` response shape unchanged.
- CHANGE — none.
