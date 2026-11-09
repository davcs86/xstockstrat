# Implementation Spec: fix-sandbox-memory-cap

**Status**: `complete`
**Created**: 2026-11-09
**Feature**: `docs/roadmap/features/300-fix-sandbox-memory-cap/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/fix-sandbox-memory-cap`

---

## Execution Summary

Everything lands in `xstockstrat-indicators` (stdlib only, no new dependency, so no `uv lock`) plus two deploy-config files. Order: (1-2) OTel gauges and the shared sandbox primitives that both mechanisms use; (3-4) the FR-2 startup probe, which ships first so the next staging deploy answers O-3; (5-8) the FR-1 watchdog in two layers, first the child handoff and the resumable `communicate` loop, then sampling, rules, kill and attribution; (9-10) the FR-3 homelab limit and its render oracle; (11) docs and drift fixes last, because the INDICATORS-* `path:line` anchors only settle after the code lands.

No proto, migration or config-key change (confirmed: `grep -n "memory_bytes" services/xstockstrat-config/migrations/*` is not touched; thresholds derive from `watcher.sandbox_memory_bytes`, `app/config/watcher.py:89-90`). The five jail constants (`_TICK_S`, `_HANDOFF_MAX`, `_PROBE_TIMEOUT_S`, `_PROBE_MOVE_MIN`, `oom_score_adj` 1000) are code constants (209 `@AC-6`, F-07).

**Consumer surfaces (C-14), decision not omission.** Agent `test_formula` and UI `/insights` formula runs are named in the product spec with **no shape or copy change**: the response already carries `exit_reason`; the UI already maps `SandboxExitReason.MEMORY_EXCEEDED` to "Out of memory" (`services/xstockstrat-ui/src/components/insights/formulaReference.ts:192`) and the servicer map handles `memory_exceeded` (`app/handlers/servicer.py` exit-reason map after `run_bounded`). No agent or UI step exists, by design.md § Consumer surfaces.

### Scenario Coverage (C-15)

| AC | Covered by step(s) |
|---|---|
| AC-1 | 8 |
| AC-2 | 4 |
| AC-3 | 4 |
| AC-4 | 8 |
| AC-5 | 8 |
| AC-6 | 6 (malformed handoff, failed-baseline silence), 8 (PermissionError sampler) |
| AC-7 | 2 (parsers), 8 (group sampling) |
| AC-8 | 8 |
| AC-9 | 10 |
| AC-10 | retired at design (sizing WARN cut); never reused |
| AC-11 | 8 |
| AC-12 | 2 (snippet is tolerant and well-formed without `Rss*` lines), 6 (grammar, seam-safe base, descriptor scope, forged write), 8 (armed values survive a forged write) |
| AC-13 | 4 |
| AC-14 | 4 |

## Step Dependencies

- Steps 5 and 6 land together (one atomic unit): Step 5 replaces the single `communicate(timeout=deadline)` call with a tick loop, which turns the existing `TestSandboxStartupGrace.test_deadline_includes_startup_grace` red (`tests/test_sandbox.py:42` asserts the first timeout is `10.0`; `FakeProc` at `:22-29` also lacks `returncode`). Step 6 holds that edit. Break radius confirmed by grep: `Popen` fakes exist only at `tests/test_sandbox.py:22-32` and `tests/test_sandbox_isolation.py:65-74` (used at `:222` and `:358`); `_killpg` is patched only at `tests/test_sandbox.py:32`.
- Step 2 covers Step 1; Step 4 covers Step 3; Step 8 covers Step 7; Step 10 covers Step 9. Steps 7 and 8 are not a unit: Step 7 keeps every existing test green on its own (the real-child suites double as the false-kill guard).
- Step 3 requires Step 1: the probe reuses `_DROP_UID`, `_HANDOFF`, `_child_headroom`, `_parse_status`, `_parse_handoff`, `_warn_unobservable_once` and the two gauge setters. Step 7 requires Step 5 (armed state, loop) and Step 1 (`_parse_stat`, `_parse_status`).
- Step 11 runs last: INDICATORS-2/9 anchors must be re-grounded against the final line numbers.
- **Soft overlap with 304** (`config-keys-relative-consumers`, status `code-completed`, not yet launched): 304 respells the `indicators.sandbox.*` key list in the `app/services/sandbox.py` docstring (`:6-9`; its own file list names nothing else in that file) and the `app/config/watcher.py` reads; 300 adds no key literal and does not touch `watcher.py`, so its `sandbox_memory_bytes` line anchors (`watcher.py:89-90`) drift if 304 lands first. Whichever lands second rebases. Step 11 records this as a **prose note** in `merge-order.md`, not a table row: the table gates a feature's final integration PR until the other is `launched`, and this overlap is textual only (file precedent: the "Launch gate: 215 ↔ 283" prose note).

### Resolved spec questions (operator decisions, 2026-11-09, recorded in `context.md`)

- **G-1 — child-side handoff: keep the design, catch nothing.** The `_HANDOFF` snippet carries no `try/except`. Provenance: design.md § 1 describes the snippet in prose only (it carries no code); the exact shape, reading the three status fields with `.get(key, 0)` defaults, is from the round-5 proposal approved at the final design gate (`context.md` round gates). With those defaults a runtime whose `/proc/self/status` lacks `RssAnon`/`RssShmem` does **not** raise: the child still writes a well-formed `H1` line (its `r0` is simply not positive, and the parent uses `max(r0, 0)`), and the parent's own sampler skips R2 silently. A failed `open`, `os.write` or `int()` parse still crashes the child before `exec` (fail-closed, as designed). A missing `VmData` is already fail-closed earlier by `_VMDATA_PROBE` (`sandbox.py:61-64`, 228 `@AC-5`). Step 1 therefore specifies the design's snippet verbatim; Step 2 adds the test that proves the no-`Rss*` case yields a well-formed line without any exception handling.
- **G-2 — keep the `_killpg` guard; findings row `:44` stays open.** `_killpg` kills only while `proc.returncode is None` (what removes the pid-reuse window by construction). design.md's second claim, that this makes the post-reap `finally` sweep real, is withdrawn: after `communicate()` has reaped the leader the sweep remains a documented no-op, exactly as today. The kill-before-reap paths (timeout, watchdog) were already correct for the timeout and are used by the watchdog. Step 11 rewrites findings row `:44` with corrected text and keeps it open, and corrects the indicators `CLAUDE.md` "killpg on timeout and every exit" bullet. A real post-reap sweep (unguarded `os.killpg(proc.pid, ...)`, with a small pid-reuse risk when the group is empty) is a separate follow-up design decision.

---

### Step 1 — service: OTel gauges and shared sandbox primitives (no behavior change)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- Gauge pattern to reuse: `_snapshot_age_source = None` `app/telemetry.py:352`, `_observe_snapshot_age` `:355`, `_SNAPSHOT_AGE = Gauge(...)` `:360-365`, `register_snapshot_age` `:390-395`; `Gauge` class `:290` (`observe()` returning `None` reports nothing, so `0` is reported).
- Sandbox instrument names `indicators.sandbox.*` `:330-338`; `_METER_NAME` `:214`.
- Setuid block to share, inline in `_SANDBOX_WRAPPER`: comment `app/services/sandbox.py:264-266`, `if os.geteuid() == 0:` `:267`, `os.setgid({sandbox_gid})` `:268`, `os.setgroups([])` `:269`, `os.setuid({sandbox_uid})` `:270`; `_SANDBOX_UID/_GID` `:57-58`; `.format(... sandbox_uid=..., sandbox_gid=...)` `:358-359`.
- Baseline snippet already shared by name: `_VMDATA_PROBE` `:61-64`, substituted at `:280` via `vmdata_probe=_VMDATA_PROBE` `:363`.
- Cap line that must keep its exact text: `if {memory_bytes} > 0:` `:281`, `_cap = min(_baseline + {memory_bytes}, 2**63 - 1)` `:282`; asserted verbatim by `tests/test_sandbox_isolation.py:353-384` (`"_cap = min(_baseline + 67108864, 2**63 - 1)" in wrapped`, and the ordered list `import pyseccomp, VmData:, setrlimit(resource.RLIMIT_DATA, json.loads(, _flt.load(), exec(`).
- Module imports `:33-41` lack `re`, `threading`, `time`; `execute_formula` imports `time` locally `:343`.
- `sandbox.py` does not import `app.telemetry` today (`grep -n "telemetry" app/services/sandbox.py` → no hits); `telemetry.py` imports only grpc/OTel, so no cycle.

**TDD**: `red-green required` (paired tests in Step 2)

**Covers**: —

**Instructions**:
1. `telemetry.py`: add two label-free observable gauges beside `_SNAPSHOT_AGE`, following its module-var + `_observe_*` + `Gauge` shape: `indicators.sandbox.memory_cap_enforced` and `indicators.sandbox.memory_watchdog_observable` (unit `""`, descriptions per FR-2). Two module vars default `None` (report nothing until set) and two setters, `set_sandbox_memory_cap_enforced(value: int)` and `set_sandbox_memory_watchdog_observable(value: int)`, each assigning the var and calling the gauge's `.register()` (same call `register_snapshot_age` makes). No attributes, no new `KEY_*` constant (telemetry allowlist, 294 AC-41).
2. `sandbox.py`, byte-identical wrapper output:
   - Add `_DROP_UID`, the existing `if os.geteuid() == 0:` four-line block pre-formatted with `_SANDBOX_UID/_SANDBOX_GID` at import time; replace lines `:267-270` of the wrapper with a `{drop_uid}` placeholder (keep the `:264-266` comments), pass `drop_uid=_DROP_UID` in the `.format(...)` and delete the now-unused `sandbox_uid=`/`sandbox_gid=` kwargs (orphans this step would create). Confirm with `grep -rn "setuid\|65534\|sandbox_uid" services/xstockstrat-indicators/tests` that no test depends on the placeholder names.
   - Add `_child_headroom(memory_bytes: int) -> int`, identity, with a docstring stating it is a test seam and the only one. In `execute_formula` compute `hr = _child_headroom(memory_bytes)` once and format the cap line as `_cap = min(_baseline + {child_headroom}, 2**63 - 1)`; `if {memory_bytes} > 0:` keeps the real value. With the identity function the rendered text equals today's.
   - Add the `_HANDOFF` snippet constant (formatted with the inherited fd number, `{fd}`), in the approved round-5 shape (design.md § 1 gives the prose; the exact `.get` reads come from that proposal, see G-1) and with **no exception handling**: `_hs = {{}}`, then `with open('/proc/self/status') as _st:` loop over lines, `_k, _, _v = _l.partition(':')`, and for `_k in ('VmData', 'RssAnon', 'RssShmem')` store `int(_v.split()[0]) * 1024`; then `os.write({fd}, ('H1 %d %d %d\n' % (resource.getrlimit(resource.RLIMIT_DATA)[0], _hs.get('RssAnon', 0) + _hs.get('RssShmem', 0) - _hs.get('VmData', 0), resource.getrlimit(resource.RLIMIT_STACK)[0])).encode())` and `os.close({fd})`. Every field is read with `.get(key, 0)`, so a missing `RssAnon`/`RssShmem` line yields a well-formed line (the parent applies `max(r0, 0)`) instead of raising. The `\n` in the generated source is the two-character escape (the template emits `\\n`, never a raw newline). It uses only `os` and `resource`, already imported at `:209-210`. It is **not yet inserted** in the wrapper (Step 5 inserts it); Step 3 consumes it.
   - Add parsers, pure and stdlib-only: `_parse_status(text) -> dict[str, int]` (bytes for `VmData`, `RssAnon`, `RssShmem` when present; kB × 1024, same rule as `_VMDATA_PROBE`); `_parse_stat(text) -> tuple[str, int, int]` returning `(state, pgrp, starttime)` from the tokens after the **last** `)` (state = token 0, pgrp = token 2, starttime = token 19); `_parse_handoff(line) -> tuple[int, int, int] | None` accepting exactly `H1 <int> <int> <int>` + `\n` with signed decimal ints (anything else → `None`). `RLIM_INFINITY` (`-1`) in the stack field is mapped to `stack_term` 0 by the consumer, not the parser.
   - Add one once-per-process registry for every "log once" record in this feature: a module-level `set[str]` guarded by a `threading.Lock` (workers are threads, `servicer.py` `run_bounded`), a helper `_first_time(key: str) -> bool` that returns `True` only the first call per key, and `_reset_once_flags()` (clears the set; tests only). Build the ERROR on it: `_warn_unobservable_once()` logs ERROR `sandbox memory watchdog cannot observe child` when `_first_time("unobservable")` and always calls `telemetry.set_sandbox_memory_watchdog_observable(0)`. Step 7's `oom_score_adj` WARN uses the same `_first_time("oom_score_adj")`, so one reset covers both flags. Add `import re` / `import threading` only if used.
3. Do not touch the wrapper order, `_SECCOMP_ALLOW`, `RLIMIT_*` lines, or `SandboxResult`.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv sync --extra dev && uv run --extra dev pytest tests/test_sandbox.py tests/test_sandbox_isolation.py tests/test_telemetry_allowlist.py -q && ruff check . && ruff format --check .
```
(run through the service venv, never a global pytest: fails.md 2026-09-28; the venv is Python 3.12.3 while prod is 3.13 — fails.md 2026-11-04 — so the sandbox suites are also re-run in Step 8 with `UV_PYTHON=3.13`.)

---

### Step 2 — test: primitives and gauges

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox_primitives.py` — create
- `services/xstockstrat-indicators/tests/conftest.py` — modify (autouse once-flag reset; shared `/proc` and handoff literals)
- `services/xstockstrat-indicators/tests/test_telemetry_allowlist.py` — modify
- `services/xstockstrat-indicators/tests/test_sandbox_isolation.py` — read-only (the wrapper-parity test imports `_fake_popen`; Step 6 owns its edit)

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- `MIN_INSTRUMENTS` set `tests/test_telemetry_allowlist.py:32-38`; `_drive()` `:47-54`; autouse `_keep_snapshot_age_source` `:42-44` restores module state via `monkeypatch.setattr(telemetry, "_snapshot_age_source", ...)`; the label-key assertion test `:67-73`.
- Metric helpers: `_data_points`/`_points` `tests/test_telemetry_instruments.py:12-25`; `metric_reader` fixture `tests/test_telemetry.py:133` (bound into other modules the way `tests/test_telemetry_allowlist.py:11` does it).
- conftest fixture style: `otel_reset` `tests/conftest.py:195-196` (monkeypatch-based).
- Wrapper-text assertion pattern: `tests/test_sandbox_isolation.py:353-384`.

**TDD**: `red-green required`

**Covers**: `AC-7` (the `/proc` text parsers: state token, pgrp after the last `)`, missing `RssAnon`), `AC-12` (handoff grammar and seam-safe base inputs; end-to-end in Steps 6 and 8)

**Instructions**:
1. `conftest.py`: add an autouse fixture that calls `sandbox._reset_once_flags()` before each test (the single process-global registry behind both once-per-process records, Step 1; AC-6 counts ERROR records exactly, and the `oom_score_adj` WARN in Step 8 relies on the same reset). Add two fixtures that return builders, consumed **by argument** rather than imported (C-13; importing helpers from `conftest` is fragile): `h1_line` (returns a callable `(cap, r0, stack) -> f"H1 {cap} {r0} {stack}\n"`) and `proc_status_text` (returns a callable building a canned `/proc/<pid>/status` text with optional `VmData`/`RssAnon`/`RssShmem`/`State` lines). Both have two or more consumers (Steps 2, 4, 6, 8).
2. `test_sandbox_primitives.py`: `_parse_status` (all three fields, kB scaling, absent `RssAnon`), `_parse_stat` (a comm containing spaces and `)`, state `Z`, pgrp and starttime indices), `_parse_handoff` (accepts the canonical line; rejects missing `\n`, extra field, non-int, `H2`, trailing garbage, negative cap accepted as int but rejected downstream), `_DROP_UID` and the wrapper text parity (render the wrapper through the existing `_fake_popen` imported from `tests/test_sandbox_isolation.py`, never a new fake, so Step 6's fake fixes cover it, and assert the setuid block text, ordering list unchanged), `_child_headroom` identity, `_warn_unobservable_once` (one ERROR across two calls via `caplog`, gauge reads 0 each call), `_first_time` (True once per key, independent keys, `_reset_once_flags` re-arms both), `_HANDOFF` formatted text contains the `\n` escape and not a raw newline, and `ast.parse` of it contains no `ast.Try` node (an AST walk, not a substring check). **Snippet behaviour (G-1, AC-12):** `exec` the formatted `_HANDOFF` in a namespace that supplies `os` and `resource` (the snippet assumes the wrapper already imported them) and whose `open` is patched to return the canned status text and whose `fd` is a real `os.pipe()` write end: (i) with all three fields it writes one well-formed line that `_parse_handoff` accepts; (ii) with `RssAnon` and `RssShmem` lines **absent** it still writes a well-formed line (no exception, `r0` not positive) and closes the fd; (iii) an `open` that raises propagates (no handler swallows it). A missing `VmData` stays fail-closed by `_VMDATA_PROBE`, already covered by `TestBaselineProbe.test_failed_probe_never_runs_formula` (`tests/test_sandbox_isolation.py:246-262`), not re-tested here.
3. `test_telemetry_allowlist.py`: add both gauge names to `MIN_INSTRUMENTS`, set both via the setters inside `_drive()`, extend `_keep_snapshot_age_source` (or a sibling autouse) to restore the two new module vars, and assert the two instruments carry no attributes.
4. Test data (C-13): the `H1` and status literals have more than one consumer after this step, so they sit in `conftest.py`, stated here rather than left blank.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_sandbox_primitives.py tests/test_telemetry_allowlist.py tests/test_sandbox_isolation.py -q && uv run --extra dev pytest --cov=app --cov-fail-under=50 -q && ruff check . && ruff format --check .
grep -n "from tests.conftest import\|\"H1 \|'H1 " services/xstockstrat-indicators/tests/test_sandbox_primitives.py   # builders arrive as fixtures: no conftest import, no inline H1 literal outside the grammar cases
```

---

### Step 3 — service: startup probe (FR-2) and `main.py` wiring

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/sandbox_probe.py` — create
- `services/xstockstrat-indicators/app/main.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- Slot: `init_telemetry()` `app/main.py:43`; config wait `await config_watcher.wait_for_snapshot(timeout_seconds=90)` `:48`; non-fatal precedent `await seed_default_formulas(db_pool)` `:62`; import block `:19-26` (`from app.services.seed_formulas import seed_default_formulas` `:25`, `from app.telemetry import ...` `:26`); `asyncio` already imported `:11`.
- `app/main.py` and `app/telemetry.py` are in the coverage `omit` list (`pyproject.toml` `[tool.coverage.run] omit`), so coverage for this step comes from `sandbox_probe.py` itself.
- Child spawn precedent to mirror: `Popen([sys.executable, "-"], ..., env=_sandbox_env(), start_new_session=True)` `sandbox.py:369-377`; teardown `os.killpg` `:315-324`.
- `mmap.mmap(-1, n, flags=MAP_PRIVATE).resize(n2)` on an anonymous map **verified on both CPython 3.12.3 (service venv) and 3.13.18** in this session (design Open Risk "unverified" is retired for the resize call itself; the 256 MiB leg is still only proven on a kernel without `RLIMIT_DATA` enforcement by the staging probe line).
- This host: root, no `/sys/fs/cgroup/memory.max` or `memory.events` (so the "unreadable counter" paths run here); `resource.getrlimit(RLIMIT_DATA)` is `(-1, -1)`.
- No `uname`/`/proc/version` logging, no `RLIMIT` enforcement probe exists anywhere (recon § Risks).

**TDD**: `red-green required` (paired tests in Step 4)

**Covers**: —

**Instructions**:
1. `sandbox_probe.py` defines `run_startup_probe()`, which **never raises** (outermost `except Exception` logs ERROR `sandbox memory probe failed`, sets both gauges to 0) and reads no config. Constants (documented as jail constants): `_PROBE_TIMEOUT_S = 15`, `_PROBE_MOVE_MIN = 8 MiB`, `_PROBE_HEADROOM = 64 MiB`, step-A map `16 MiB`, step-B size `256 MiB`.
2. Child: `[sys.executable, "-c", _PROBE_SCRIPT]` with `stdin=PIPE`, `stdout=PIPE`, `stderr=DEVNULL`, `pass_fds=(w,)` for a fresh `os.pipe()` (parent closes `w` after `Popen`, closes `r` in `finally`), `env=_sandbox_env()`, `start_new_session=True`; no seccomp, no untrusted code. The script imports numpy and `mmap` first, then the shared `_DROP_UID` and `_VMDATA_PROBE`, sets `RLIMIT_DATA = baseline + _child_headroom(_PROBE_HEADROOM)`, runs the shared `_HANDOFF` snippet (the same tolerant, handler-free snippet the formula wrapper uses), prints `set <cap>`, then a stdin-synchronised protocol: print `s0` and block on a stdin line; map and write 16 MiB `MAP_PRIVATE`; print `s1` and block again; then step B, print one `legs a b c` line (1 = refused, 0 = allowed) and exit.
3. Step B, each mapping closed before the next, 256 MiB each: (a) `mmap.mmap(-1, n, flags=MAP_PRIVATE)`; (b) `mmap.mmap(-1, 16 MiB, flags=MAP_PRIVATE).resize(n)` (the real `mremap`); (c) the literal repro `np.zeros(1)` then `.resize(..., refcheck=False)`. A leg counts as refused only on `MemoryError` or `OSError` with `errno.ENOMEM`; any other exception → probe failed. `enforced` = all three refused; a split counts as not enforced.
4. Parent I/O: `selectors.DefaultSelector` + `os.read` on raw fds with a private line buffer (not `select.select`, not `readline`), whole exchange under `_PROBE_TIMEOUT_S`; on timeout `os.killpg(proc.pid, SIGKILL)` then reap. Samples at `s0`/`s1` use the shared `_parse_status` on `/proc/<pid>/status` (root parent reading a uid-65534 child, as production).
5. Verdicts: `observable` = well-formed handoff (shared `_parse_handoff`) AND `cap_read == cap_set` AND `VmData` moved ≥ `_PROBE_MOVE_MIN` between `s0` and `s1` AND no `PermissionError`. `rssanon_delta` is logged separately (`r2_viable`); gauge 0 means "R1 blind".
6. Output: one INFO `sandbox memory probe` record with: `uname` fields, `/proc/version`, cgroup `memory.max` (v2 path, else v1 `memory.limit_in_bytes`, else `absent`), `rlimit_data_hard`, `cap_set`, `cap_read`, `vmdata_delta`, `rssanon_delta`, `probe_rss`, `oom_score_adj` read-back, `oom_kill_readable`, the three refused flags, `enforced`, `observable`. ERROR `sandbox memory cap not kernel-enforced` when not enforced; `_warn_unobservable_once()` (Step 1) when not observable; ERROR `sandbox memory probe failed` on timeout, crash, missing/malformed line or unexpected exception (both gauges 0, and the "not kernel-enforced" record is **not** emitted). Gauges via the Step 1 setters (`enforced` and `observable` as 0/1).
7. `main.py`: import `run_startup_probe` and call `await asyncio.to_thread(run_startup_probe)` immediately after `init_telemetry()` (`:43`) and before the config connect/wait, so the fingerprint logs even when config is unreachable. The service always continues.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev python -c "import logging; logging.basicConfig(level=logging.INFO); from app.services.sandbox_probe import run_startup_probe; run_startup_probe()" 2>&1 | grep -c "sandbox memory probe"   # exactly one INFO line; the call returns and never raises
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_sandbox.py tests/test_sandbox_isolation.py -q && ruff check . && ruff format --check .
grep -n "run_startup_probe\|init_telemetry()\|wait_for_snapshot" services/xstockstrat-indicators/app/main.py   # probe line sits between init_telemetry and wait_for_snapshot
```

---

### Step 4 — test: startup probe and gauges

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox_probe.py` — create

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- Seam: `_child_headroom` (Step 1). Patching `sandbox_probe._child_headroom` to return `2**40` lifts the kernel cap so the three 256 MiB legs succeed, emulating a non-enforcing kernel on CI (the `min(_baseline + hr, 2**63 - 1)` clamp at `sandbox.py:282` never bites at `2**40`).
- `caplog` ERROR assertions precedent: `tests/test_sandbox_telemetry.py` (`caplog`, `metric_reader` bound at its line 14-15).
- Real-child sandbox tests run through `execute_formula` with the venv interpreter (`sys.executable`): fails.md 2026-09-28.
- CI runs non-root, so `_DROP_UID` is a no-op in CI; the root→65534 `/proc` read path is validated only by the staging probe line (design Open Risks), recorded here as a known limit.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-13, AC-14`

**Instructions**:
1. AC-3 (enforcing): run `run_startup_probe()` unpatched; assert no `sandbox memory cap not kernel-enforced` record, `memory_cap_enforced` gauge 1 and `memory_watchdog_observable` gauge 1 (via `metric_reader`), and the INFO `sandbox memory probe` record fields are present. This is the test that turns red on CI if `mmap.resize` raises a non-ENOMEM error (design risk).
2. AC-2 (non-enforcing): patch `sandbox_probe._child_headroom` to `2**40`; assert the ERROR record `sandbox memory cap not kernel-enforced`, `memory_cap_enforced` reads 0, the call returns normally, and a following `execute_formula("result = 1", ...)` succeeds (the "keeps serving" half; `main.py` is coverage-omitted and not importable without a config server, so also assert, by reading `main.py` source as `tests/test_sandbox_isolation.py:353-384` reads the wrapper, that `run_startup_probe` appears after `init_telemetry()` and before `wait_for_snapshot`).
3. AC-13 (failed probe): three parametrised cases by patching `_PROBE_SCRIPT` (child `raise SystemExit(3)`; a child that sleeps with `_PROBE_TIMEOUT_S` patched small, asserting the group is killed and reaped; a child that prints a malformed `legs` line). Each: ERROR `sandbox memory probe failed`, no `not kernel-enforced` record, both gauges 0, returns without raising.
4. AC-14 (unobservable): patch the probe's `/proc` reader so `VmData` is constant across `s0`/`s1`; assert ERROR `sandbox memory watchdog cannot observe child`, observable gauge 0, the call returns, and the once-flag is set (a later `_warn_unobservable_once()` logs nothing).
5. Test data (C-13): take the `h1_line` and `proc_status_text` fixtures from `conftest.py` (Step 2) by argument for the handoff and sampler fakes; no inline copies and no `from tests.conftest import`.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_sandbox_probe.py -q && uv run --extra dev pytest --cov=app --cov-fail-under=50 -q && ruff check . && ruff format --check .
grep -n "from tests.conftest import\|\"H1 \|'H1 " services/xstockstrat-indicators/tests/test_sandbox_probe.py   # no conftest import, no inline H1 literal
```

---

### Step 5 — service: watchdog layer 1, child handoff and the tick loop

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Lands with**: `Step 6`

**Codebase Evidence**:
- Single blocking wait to replace: `stdout, stderr = proc.communicate(input=wrapped, timeout=deadline_ms / 1000)` `app/services/sandbox.py:380`; timeout path `:381-393` (`_killpg`, `proc.communicate()` reap, `SandboxResult(exit_reason="timeout", execution_ms=timeout_ms, error=f"Formula execution timed out after {timeout_ms}ms")`); `elapsed_ms` `:395`; `finally: _killpg(proc)` `:443-445`.
- `deadline_ms = timeout_ms + grace_ms` `:347`; local `import time` `:343`; `start = time.monotonic()` `:368`; `Popen(...)` `:369-377` with no `pass_fds`.
- `_killpg` body `:321-324` uses `os.getpgid(proc.pid)`, a no-op after reap (findings `context-constitution-findings.md:44`; INDICATORS-9).
- Wrapper insertion point: after the `RLIMIT_DATA` block `:281-283` and before `RLIMIT_CPU` `:284`, so before `json.loads` `:290`, seccomp `.load()` `:301` and `exec` `:306`.
- Caller context: `execute_formula` has one production caller, `app/handlers/servicer.py:339-348`; the 295 deadline clamp `:321-337` is computed by the caller and unchanged.
- Fakes that must be tolerated: `tests/test_sandbox.py:22-29` (no `returncode`) and `tests/test_sandbox_isolation.py:66-74` (sets `returncode` only inside `communicate`, `pid = 2**30`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module alias `_monotonic = time.monotonic` (module-level `import time`; delete the local import at `:343`) and use `_monotonic()` for `start` and `elapsed_ms`. Tests patch the alias, never global `time`.
2. Active only when `memory_bytes > 0`. Before `Popen`: `r, w = os.pipe()`; `os.set_blocking(r, False)`; format the wrapper with the `_HANDOFF` text (Step 1, fd = `w`) placed between the `RLIMIT_DATA` block and the `RLIMIT_CPU` line; `Popen(..., pass_fds=(w,))`. Close `w` immediately after `Popen` and in an `except` around it; close `r` in a `try/finally` that also covers a raising `Popen`. With `memory_bytes <= 0` the snippet, pipe and `pass_fds` are all omitted and the loop below still runs without a handoff.
3. Replace `:380` with a loop: `deadline = start + deadline_ms/1000` on `_monotonic`; each pass calls `proc.communicate(input=wrapped if first else None, timeout=min(_TICK_S, remaining))` with `_TICK_S = 0.05`; `TimeoutExpired` is a tick unless `remaining <= 0`, which enters the **unchanged** timeout path (same `SandboxResult`, same error text, same `execution_ms=timeout_ms`). `communicate` stays the only reaper.
4. Handoff reader, per tick before any sampling: bounded read (`_HANDOFF_MAX = 128`) of the first complete line only, non-blocking. States: PENDING (nothing yet, no action), ARMED (a pure function `_arm_from_handoff(line: str, hr: int) -> _Armed | None` parses via `_parse_handoff` and returns `_Armed(cap, base, r0, stack)` with `base = cap - hr`, or `None` for a malformed line or `base <= 0`; `hr = _child_headroom(memory_bytes)` is computed once per run; thresholds in Step 7 use the real `memory_bytes`), ABSENT (EOF or child exit with no line: no record, existing classification), MALFORMED (not exactly `H1 <int> <int> <int>`, no `\n` within the bound, or `base <= 0`: call `_warn_unobservable_once()` and run the rest of this run un-armed). Armed values are stored once; a second read never re-arms (AC-12).
5. `_killpg(proc)` body becomes `os.killpg(proc.pid, signal.SIGKILL)` guarded by `proc.returncode is None`, still catching `ProcessLookupError`/`PermissionError`; the timeout path calls it **before** `proc.communicate()` reaps (kill-before-reap). Per resolved question G-2 the guard stays and the post-reap `finally` call remains a documented no-op (identical to today's effect); this step does **not** close findings row `:44`, and no instruction or test here may claim a post-reap sweep.
6. Do not add sampling, rules or classification here (Step 7).

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_sandbox.py tests/test_sandbox_isolation.py tests/test_sandbox_deadline.py tests/test_execute_formula_concurrency.py -q && ruff check . && ruff format --check .
grep -n "_monotonic\|_TICK_S\|pass_fds\|_HANDOFF_MAX" services/xstockstrat-indicators/app/services/sandbox.py
```

---

### Step 6 — test: handoff and tick loop (existing deadline test edited in this unit)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox.py` — modify (`TestSandboxStartupGrace`)
- `services/xstockstrat-indicators/tests/test_sandbox_isolation.py` — modify (`_FakeProc` gets `returncode = None`; `_fake_popen` records `wrapped` only when `input is not None` and keeps `kwargs`)
- `services/xstockstrat-indicators/tests/test_sandbox_watchdog.py` — create

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Lands with**: `Step 5`

**Codebase Evidence**:
- Test to rewrite: `tests/test_sandbox.py:19-43`; the assertion `seen["first"] == (5000 + 5000) / 1000` is `:42`, `res.exit_reason == "timeout"` `:43`, error text `:44`.
- `_fake_popen` `tests/test_sandbox_isolation.py:65-74` (stores `input` unconditionally at `:70`, which the retry `communicate(input=None)` would overwrite with `None`); consumers `:222` (OpenBLAS classification) and `:358` (wrapper text).
- Failed-baseline precedent to mirror: `TestBaselineProbe.test_failed_probe_never_runs_formula` `tests/test_sandbox_isolation.py:246-262` (patches `_VMDATA_PROBE` with `VmAbsent:`).
- Existing assertions that must still hold unchanged: wrapper ordering list and `_cap` text `:353-384`.

**TDD**: `red-green required`

**Covers**: `AC-6, AC-12`

**Instructions**:
1. Rewrite `test_deadline_includes_startup_grace`: patch `sandbox._monotonic` with a fake clock; `FakeProc` defines `returncode = None`, raises `TimeoutExpired` from every `communicate` call until the clock passes `start + 10.0`, then keeps timing out. Assert: every tick timeout is `<= 0.05`; the loop ends only once the clock reaches `10.0` (the 5000 + 5000 ms wall deadline), then `res.exit_reason == "timeout"` and the error equals `"Formula execution timed out after 5000ms"`. Keep the `_killpg` patch (`:32`).
2. Fake-Popen hazards from design.md (all in this step): fakes define `returncode = None` up front; the handoff-path fake writes an `H1 …` line (or garbage) to `pass_fds[0]` of the captured kwargs and raises `TimeoutExpired` at least once before returning; `FileNotFoundError` on fake pids is silent.
3. `test_sandbox_watchdog.py`, AC-6 (handoff half): with a patched `_HANDOFF` that writes a garbage line, run two ≥ 0.5 s pure-Python-loop formulas (long enough to span several 50 ms ticks; a fast formula ends inside one tick and is silent by design) in one process: assert exactly one ERROR `sandbox memory watchdog cannot observe child`, the observable gauge 0, and both results are normal. A child that exits before writing the handoff (patch `_VMDATA_PROBE` as at `:246-262`) emits no such record.
4. AC-12: (a) `_arm_from_handoff` (Step 5): `base = cap - hr` is identical for `hr = memory_bytes` and `hr = 2**40`; (b) a real-child formula run with `allowed_imports` including `os` tries `os.write(fd, b"H1 1 1 1\n")` for every `fd` in `range(3, 64)` (the handoff descriptor number is not known to the formula, and `NOFILE=64` bounds the search) and records which writes succeeded: assert none succeeded (every descriptor is closed or not the handoff pipe) and the run returns normally, the armed values unchanged; (c) fake-Popen kwargs show `pass_fds` is exactly the one `w` fd of that run, and two concurrent calls never share it.
5. `memory_bytes <= 0`: no `pass_fds`, no snippet in the captured wrapper.
6. Test data (C-13): take the `h1_line` fixture from `conftest.py` (Step 2) by argument; the fake-clock helper is single-consumer inline here.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_sandbox.py tests/test_sandbox_isolation.py tests/test_sandbox_watchdog.py tests/test_sandbox_deadline.py -q && uv run --extra dev pytest --cov=app --cov-fail-under=50 -q && ruff check . && ruff format --check .
```

---

### Step 7 — service: watchdog layer 2, group sampling, rules, kill and `-9` attribution

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/services/sandbox.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- Classification block to reorder: `if proc.returncode != 0:` `app/services/sandbox.py:414`, import-blocked `:416-417`, `_MEMORY_EXHAUSTED_MARKERS` `:418-419` (defined `:201`), the "formula exited with code {proc.returncode} before producing output" fallback `:422`, and "formula produced no output" `:426-427`.
- `SandboxResult.exit_reason` set `"success"|"timeout"|"memory_exceeded"|"runtime_error"|"import_blocked"` `:197`; servicer map `app/handlers/servicer.py` (`exit_reason_map` after `run_bounded`), `record_sandbox_execution` and the WARN already carry `memory_exceeded`, so no servicer/telemetry change.
- `_fail(error, exit_reason)` closure `:397-407` is the reporting path to reuse.
- Config threshold source: `sandbox_memory_bytes` `app/config/watcher.py:89-90` (`int_positive`, default 128 MiB); passed into `execute_formula` as `memory_bytes` from `servicer.py:339-348`.
- Seccomp allowlist has no `open`/`openat`/`ptrace`/`process_vm_*` (`:71-122`), so every `/proc` read is parent-side; the root parent can read the uid-65534 child only if the runtime allows it (design Open Risk, validated by the staging probe line).
- Cgroup v2 file `/sys/fs/cgroup/memory.events` absent on this host (so the "unreadable → `runtime_error`" branch is the one CI exercises).

**TDD**: `red-green required` (paired tests in Step 8)

**Covers**: —

**Instructions**:
1. Group sample each tick after arming, as a named function `_sample_group(leader_pid: int, state: _GroupState) -> _Sample` (`_GroupState` holds the armed values, the per-member `ref` map and the running peaks; tests patch or drive `_sample_group` by name): list the module constant `_PROC = "/proc"` (a constant so tests can point it at a synthetic tree), keep pids whose `_parse_stat` pgrp equals `proc.pid`; per member open `/proc/<pid>` as a dirfd and read `stat` and `status` relative to it (`os.open(..., dir_fd=)`). Members keyed `(pid, starttime)`; a reused pid with a new `starttime` is a new member. State `Z`/`X` contributes 0, emits nothing, and is never evidence of "cannot observe". `FileNotFoundError`/`ProcessLookupError` contribute 0 silently. Cannot-observe evidence is only `PermissionError`, or a running member with neither `VmData` nor `RssAnon`.
2. Rules (strict `>`, thresholds use the real `memory_bytes`):
   - **R1**: group `VmData` growth > `memory_bytes`. Leader: `VmData - base`. Non-leader members: `max(0, VmData - ref)` with `ref` its own `VmData` at first sight (growth-only, so a COW fork child counts about 0).
   - **R2**: group `Σ(RssAnon + RssShmem)` over non-zombie members > `base + memory_bytes + max(r0, 0) + stack_term`, with `stack_term` the reported stack soft limit when finite and 0 for `RLIM_INFINITY` (`-1`). If only `RssAnon` is missing from a running member, skip R2 for this run silently and keep R1; if only `VmData` is missing, skip R1 and keep R2.
   - On cannot-observe evidence: `_warn_unobservable_once()` and un-arm the run (fail-open: it still runs under `RLIMIT_DATA`, the timeout, the container limit and `oom_score_adj`).
3. Kill: on breach set `killed_by_watchdog`, call `_killpg(proc)` (Step 5; kill-before-reap), then let the loop's `communicate()` reap. Record `peak_vmdata_growth` and `peak_resident` and log one DEBUG `sandbox watchdog peak` record per armed run.
4. Classification order, before the stderr logic at `:414-427`: (1) `killed_by_watchdog` → `exit_reason="memory_exceeded"` through `_fail`; (2) timeout unchanged; (3) `returncode != 0`: import-blocked, then stderr markers, then `returncode == -9` with the cgroup-v2 `memory.events` `oom_kill` count read before `Popen` and again after reap rising → `memory_exceeded`; otherwise the existing text `formula exited with code -9 before producing output` with `runtime_error`. An unreadable counter → `runtime_error`. Error text is not changed (268 and `docs/runbooks/indicator-builder.md:244` wording preserved). Add a small `_oom_kill_count() -> int | None` that parses the `oom_kill` line of the module constant `_OOM_EVENTS_PATH = "/sys/fs/cgroup/memory.events"` (a constant so tests can point it at a temp file).
5. `oom_score_adj`: right after `Popen` (before the first `communicate`; the parent is root and may raise the value of any child, so the child's own uid does not matter), write `1000` to `f"{_PROC}/{proc.pid}/oom_score_adj"`. `FileNotFoundError` is silent (fake pids); any other failure logs WARN once per process via `_first_time("oom_score_adj")` (Step 1's single registry, so Step 2's autouse reset covers it; no second hook). The trade-off is documented in Step 11: in a cgroup OOM the largest child dies, which may be a legitimate concurrent formula.
6. Leave `SandboxResult.memory_used_bytes = 0` (`:390,404,439`): out of scope (separate defect reports).

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_sandbox.py tests/test_sandbox_isolation.py tests/test_sandbox_deadline.py tests/test_sandbox_telemetry.py tests/test_execute_formula_concurrency.py tests/test_sandbox_watchdog.py -q && ruff check . && ruff format --check .
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_sandbox_isolation.py -q -k "Headroom or Numeric or ForkBomb"   # 800x800 matmul, 32 MiB under 64 MiB, fork-bomb recovery stay green with the watchdog active
```

---

### Step 8 — test: watchdog behavior, attribution and evasion cases

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_sandbox_watchdog.py` — modify
- `services/xstockstrat-indicators/tests/test_sandbox_isolation.py` — read-only reuse of `_LINALG_800_SRC` (`:50-55`), `_ALLOC_32MIB_SRC` (`:57-59`), `_run` (`:47`), `_MIB` (`:49`)

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- Seam to emulate a non-enforcing kernel: patch `sandbox._child_headroom` to return `2**40` (Step 1); the watchdog still enforces the real `memory_bytes`.
- Real-child golden: matmul trace `641260.869`, rank `50` (`tests/test_sandbox_isolation.py:50-55`; asserted by 228 `@AC-1`).
- Fork-bomb precedent: `TestForkBombCapped` `tests/test_sandbox_isolation.py:335-349`.
- Default imports `numpy,pandas,math,statistics` (`app/config/watcher.py:93-96`); `ctypes` is imported by the wrapper at `app/services/sandbox.py:206`, which is the attribute-traversal path AC-11 must prove.
- Design requires the test to hold the allocation until the kill: a burst finishing inside one 50 ms tick is a documented residual.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-4, AC-5, AC-6, AC-7, AC-8, AC-11, AC-12` (plus the `oom_score_adj` path of design.md § 1, which has no AC of its own)

**Instructions**:
1. AC-1: with `_child_headroom → 2**40` and `memory_bytes = 128 MiB`, run `np.zeros(50_000_000)`, write `a[:] = 1.0` (≈ 400 MiB), then spin until stopped (bounded pure-Python loop, never a bare `while True` without a timeout). Assert `exit_reason == "memory_exceeded"`, `"MemoryError" not in res.stderr`, and the DEBUG `sandbox watchdog peak` record shows `peak_vmdata_growth > 128 MiB` (the kill came from the parent, not the formula).
2. AC-4: with the kernel cap lifted (same seam) and `memory_bytes = 64 MiB`, the 800×800 matmul returns trace `641260.869` and rank `50`, and a 32 MiB `np.ones` array succeeds; assert the recorded peaks stay below the R1 and R2 thresholds. **Record the observed peaks and the per-run slack in `context.md`** (design Open Risk: R2 near-cap false-kill margin).
3. AC-5: fake Popen exiting with `returncode = -9`, the watchdog flag unset; point `sandbox._OOM_EVENTS_PATH` at a temp file whose `oom_kill` count rises by 1 → `memory_exceeded`; by 0 or an unreadable file → `runtime_error`; error text `formula exited with code -9 before producing output` in both.
4. AC-6 (observability half): patch `sandbox._sample_group` to raise `PermissionError`; two formulas in one process → exactly one ERROR `sandbox memory watchdog cannot observe child`, observable gauge 0, both normal results.
5. AC-7: drive the group sampler with a synthetic `/proc` tree (temp directory standing in for the root, built with the conftest status builder): COW member not grown contributes ~0; a pid reused with a new `starttime` is a new member; a zombie leader or member contributes 0 and logs nothing; a running member without `RssAnon` skips only R2, no record.
6. AC-8: real fork-until-NPROC formula with the watchdog active: result is not success; a following legitimate formula succeeds; no `cannot observe` record. The result may be `runtime_error` or `memory_exceeded` (residual (d)); assert only "typed, not success".
7. AC-11: with the watchdog active, a `mmap.mmap(-1, n, flags=MAP_SHARED)`-style grow, touch-then-`mprotect(PROT_READ)` via `ctypes`, and a sampler stripped of `VmData` each end `memory_exceeded` (R2); plus one run on the production default imports only that reaches `ctypes` by attribute traversal from `numpy`. If that traversal is confirmed to work on the native kernel, record the confirmed exposure in `context.md` for Step 11's findings row.
8. AC-12 (armed values survive): after the child closed its handoff, a forged `H1` write attempt leaves the DEBUG record's thresholds unchanged.
9. `oom_score_adj` (Step 7 instruction 5): point `sandbox._PROC` at a temp tree with a writable `<pid>/oom_score_adj` and assert `1000` is written; point it at an unwritable entry and assert exactly one WARN across two runs in one process (the autouse `_reset_once_flags` from Step 2 resets the registry between tests); a missing `<pid>` directory (the fake-pid case) logs nothing.
10. Test data (C-13): the synthetic `/proc` tree builder takes the `proc_status_text` fixture and the handoff line takes `h1_line`, both by argument from `conftest.py`; the 400 MiB/32 MiB/matmul sources reuse `test_sandbox_isolation.py` constants by importing them rather than re-declaring them (single owner there).

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run --extra dev pytest tests/test_sandbox_watchdog.py -q && uv run --extra dev pytest --cov=app --cov-fail-under=50 -q && ruff check . && ruff format --check .
cd services/xstockstrat-indicators && UV_PYTHON=3.13 uv run --extra dev pytest tests/test_sandbox_isolation.py tests/test_sandbox_watchdog.py tests/test_sandbox_probe.py -q   # prod interpreter (fails.md 2026-11-04)
```

---

### Step 9 — config: homelab indicators container limit and render oracle (deploy configuration, not a `WatchConfig` key)

**Status**: `done`
**Service**: `deploy/homelab`
**Files**:
- `deploy/homelab/compose.yml` — modify
- `deploy/homelab/render-assert.jq` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- Block to edit: `xstockstrat-indicators:` `deploy/homelab/compose.yml:159` (no `mem_limit`/`memswap_limit`/`deploy:` anywhere in the file or `docker-compose.yml`: `grep -rn "mem_limit\|memswap" deploy docker-compose.yml scripts .github/workflows` → no hits).
- Comment to update: `# start_period exceeds the Go/Node/Python 90 s config-snapshot wait.` `:24`, `x-hc: &hc` `:25` (`start_period: 120s`, `retries: 6`, `interval: 5s`); the probe adds up to 15 s before the 90 s config wait, then DB pool and seeding.
- Oracle projection: `def project` `deploy/homelab/render-assert.jq:14-22` projects `image/bv/hc/deps/ports/env`; label emission list `:23-42`; labels carry no values (`:1-2`).
- Compose v5.6.1 renders `mem_limit: 2g` as the JSON **string** `"2147483648"` (verified in this session; an absent key projects to `"null"` through `tostring`), so comparison goes through `tostring`.
- DO: `.do/app.yaml:197` and `.do/app.dev.yaml:197` already set `instance_size_slug: basic-s` for `xstockstrat-indicators`: no DO spec change.

**TDD**: `red-green required` (paired tests in Step 10)

**Covers**: —

**Instructions**:
1. `compose.yml`: in the indicators service add `mem_limit: 2g` and `memswap_limit: 2g` (parity with DO `basic-s`, 2 GB, `docs/runbooks/infra-cost-reduction.md:15`).
2. Update the comment at `:24` to state that `start_period` must also cover indicators' up-to-15 s startup probe, the 90 s config wait, the DB pool and formula seeding. Do not change `start_period` (design only asks for the comment).
3. `render-assert.jq`: add `mem` and `swap` to `project` (`(.mem_limit | tostring)`, `(.memswap_limit | tostring)`), and emit only the label `mem-limit:xstockstrat-indicators` when either differs from `"2147483648"`; the label prints no value (same rule as `:1-2`). An empty render still cannot pass (existing `services` label).

**Verification**:
```bash
bash scripts/homelab-render.test.sh   # builds real release .env files and renders; assertion 7 requires the unmodified production render to yield [] with the new projection
grep -n "mem_limit\|memswap_limit" deploy/homelab/compose.yml   # both present, 2g, in the xstockstrat-indicators block only
```

---

### Step 10 — test: render-oracle mutations

**Status**: `done`
**Service**: `deploy/homelab`
**Files**:
- `scripts/homelab-render.test.sh` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, no side-effects from formula execution, timeout enforcement

**Codebase Evidence**:
- `mutate()` helper `scripts/homelab-render.test.sh:~140-145` (`mutate <label> <jq filter> [target]`; fails when the label is absent or any value, `$probe`, is printed); existing mutations `:146-165`; the unmodified-production assertion `[ "$(jq -c ... "$work/prod.json")" = "[]" ]` above them; harness needs `docker`, `jq`, `python3`, `openssl` and runs without a daemon.
- `render-assert.jq` label form `"<label>:<service>"` e.g. `healthcheck:xstockstrat-ledger`.

**TDD**: `red-green required`

**Covers**: `AC-9`

**Instructions**:
1. Add beside the existing `mutate` calls: delete `mem_limit`; delete `memswap_limit`; set `mem_limit` to `"1073741824"` (1g); each must report `mem-limit:xstockstrat-indicators` and (via `mutate`'s existing probe check) print no value.
2. Add one positive assertion that the unmodified production render still passes (already asserted; keep it ahead of the new mutations) and that the rendered indicators service has both values equal `2147483648`.

**Verification**:
```bash
bash scripts/homelab-render.test.sh
```
(requires `docker compose`, `jq`, `python3`, `openssl`; prints `homelab-render.test.sh: all assertions passed`.)

---

### Step 11 — docs: service docs, constitution anchors, findings, drift fixes

**Status**: `done`
**Service**: `docs`
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify (§ Sandbox Security Model, § Observability; sizing formula)
- `services/xstockstrat-indicators/docs/context-constitution.md` — modify (INDICATORS-2 and INDICATORS-9 rows, `:19` and `:26`)
- `services/xstockstrat-indicators/docs/context-constitution-findings.md` — modify (latent-bug row at `:44`; new native-kernel row)
- `docs/setup/digitalocean.md` — modify (`:252` and `:262` only; `:33`, `:34`, `:223` are generic size statements that do not name indicators and stay untouched)
- `docs/runbooks/infra-cost-reduction.md` — modify (`:18`)
- `docs/roadmap/features/merge-order.md` — modify (a prose note, not a table row; unconditional per the operator's 2026-11-09 decision)

**Reviewers**: none

**Codebase Evidence**:
- `.do/app.yaml:197` and `.do/app.dev.yaml:197` set `basic-s` for `xstockstrat-indicators`. Docs that misstate indicators: `docs/setup/digitalocean.md:252` ("`basic-xs` (1 GB — `indicators`, `ingest`, `analysis`, `agent`, `ui`)") and `:262` (prod "uses `basic-xs` instances (`basic-s` for `xstockstrat-config`, ...)"); `docs/runbooks/infra-cost-reduction.md:18` ("Python services (`indicators`, `ingest`, `analysis`, `agent`) | `basic-xs` | `basic-xs`"). `digitalocean.md:33`, `:34`, `:223` are generic size statements that do not name indicators. The same docs are broadly stale for other services (for example `.do/app.yaml` sets `ingest`/`analysis` to `basic-xxs` and `config` to `basic-xxs`): only the indicators mapping is in scope here, because the homelab 2 GiB limit's parity claim rests on it.
- `merge-order.md` form: its table gates a feature's final integration PR until the other feature is `launched` (file header); the file already carries prose notes for non-gating relationships (for example "Launch gate: 215 ↔ 283").
- `services/xstockstrat-indicators/CLAUDE.md:148-149` claims "`killpg(SIGKILL)` on timeout **and every exit** — a `fork()+sleep(∞)` grandchild cannot survive": false on the success and non-zero-exit paths (findings row `:44`).
- INDICATORS-2 row cites `_VMDATA_PROBE :61-64`, `:284`, `:283`, `:279`; INDICATORS-9 cites `_killpg ~L320`, `~L327`, `start_new_session ~L379` (`services/xstockstrat-indicators/docs/context-constitution.md:19,26`): all drift after Steps 1-7.
- Findings latent-bug row `services/xstockstrat-indicators/docs/context-constitution-findings.md:44` (`finally: _killpg(proc)` no-op), the open-questions bullets at `:21-31`.
- CLAUDE.md sections: `## Sandbox Security Model` and `## Observability (feature 294-signal-map-instrumentation)` in `services/xstockstrat-indicators/CLAUDE.md`; `Expanded rlimits` and `Deterministic termination` bullets.
- Durable business-rule suites (`services/xstockstrat-indicators/acceptance/*.feature`) are **not** hand-edited (C-16); promotion happens at launch.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Indicators `CLAUDE.md`: § Sandbox Security Model gets a watchdog bullet (50 ms parent tick, child-reported handoff, R1/R2, `memory_exceeded` from the parent's kill or the cgroup `oom_kill` delta, `oom_score_adj` 1000) and the documented residuals (a)-(d) from product-spec FR-1, plus (e) "R1/R2 cannot fire before `RLIMIT_DATA`" is an empirical claim backed by recorded peaks. § Observability: the two gauges (no labels), the INFO `sandbox memory probe` line, the three ERROR strings, the DEBUG `sandbox watchdog peak` record. Add the sizing formula `parent + max_concurrent × (baseline + memory_bytes + overshoot)` (about 1-1.4 GiB at defaults against 2 GiB) and an owned follow-up: re-check it when live `sandbox.max_concurrent`/`sandbox.memory_bytes` change (no sizing WARN: cut by the operator). Document the `oom_score_adj` 1000 trade-off (the largest child dies in a cgroup OOM, possibly a legitimate concurrent formula). Correct the `Deterministic termination` bullet (`:148-149`): kill-before-reap on timeout and on a watchdog breach; the success and non-zero-exit paths do **not** sweep survivors after the leader is reaped (G-2), so the "every exit" claim is withdrawn.
2. INDICATORS-2 and INDICATORS-9: add the watchdog and the kill-before-reap `_killpg`, state the per-run fail-open and burst residuals, and re-ground every `path:line` against the final `sandbox.py` (grep each symbol; do not copy the old numbers).
3. Findings: rewrite `:44` per G-2 with corrected text and **keep it open** (nothing in this feature closes it): the timeout path and the watchdog kill before the leader is reaped, but the `finally` sweep on the success and non-zero-exit paths stays a no-op because the leader is already reaped; a real post-reap sweep is a separate follow-up design decision. Add the row "native-kernel exposure: a formula reaches `CDLL` via `object.__subclasses__()` (ctypes is imported at the wrapper top) and can `mmap(MAP_SHARED)` outside `data_vm`, so 209 `@AC-3` is evadable off-DO" marked `open — fix in 300` until launch, closed by AC-11 (use Step 8's recorded result).
4. Doc drift (indicators only): `digitalocean.md:252` — pull `indicators` out of the `basic-xs (1 GB — ...)` list and state `basic-s` (2 GB) for it; `:262` — add indicators to the `basic-s` exception alongside the prose that is already there, and do not alter any other service's stated size; `infra-cost-reduction.md:18` — split `indicators` into its own row `basic-s` | `basic-s` (1 vCPU / 2 GB, size defined at `:15`), keeping `ingest`, `analysis`, `agent` on the existing row. Confirm indicators' size with `grep -n "instance_size_slug" -B12 .do/app.yaml .do/app.dev.yaml` before editing.
5. `merge-order.md`: add a **prose note** (no table row) titled for the 300 ↔ 304 relationship: `fix-sandbox-memory-cap` (300) and `config-keys-relative-consumers` (304, `code-completed`) overlap textually on `app/services/sandbox.py` (304: docstring key list `:6-9`), `app/config/watcher.py` (304 only; 300's `sandbox_memory_bytes` anchors drift if 304 lands first) and shared test files; non-blocking, whichever merges second rebases and re-greps its line anchors. Also name the indicators `services/xstockstrat-indicators/CLAUDE.md` overlap (304 edits the banner `:84-85` and the five key rows `:91-95`; 300 edits § Sandbox Security Model and § Observability). State why it is not a table row (the table gates a final integration PR until the other is `launched`), date the note, and end it with the file's precedent footer "Operator-approved as a prose note so it does not gate either integration PR." (operator decision recorded in `context.md`, 2026-11-09). Unconditional: no review confirmation gates this edit.
6. Not a step, recorded for the operator: the owned advisory post-deploy checklist in `design.md` § Open Risks (items 1-6) is run after the first staging deploy and results go into `context.md`; nothing enforces it.

**Verification**:
```bash
grep -n "basic-xs" docs/setup/digitalocean.md docs/runbooks/infra-cost-reduction.md | grep -i indicators   # no stale 'indicators ... basic-xs' mapping remains
grep -n "fix-sandbox-memory-cap" docs/roadmap/features/merge-order.md   # the prose note exists
grep -n "every exit" services/xstockstrat-indicators/CLAUDE.md   # no remaining claim of a post-reap sweep
grep -n "memory_cap_enforced\|memory_watchdog_observable\|sandbox memory probe" services/xstockstrat-indicators/CLAUDE.md
grep -n "INDICATORS-2\|INDICATORS-9" services/xstockstrat-indicators/docs/context-constitution.md
for s in _TICK_S _killpg _HANDOFF _warn_unobservable_once; do grep -n "$s" services/xstockstrat-indicators/app/services/sandbox.py | head -1; done   # anchors named in the docs resolve
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
