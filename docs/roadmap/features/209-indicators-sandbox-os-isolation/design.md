# Design: indicators-sandbox-os-isolation (feature 209)

_Phase 1 debated design. 4-round full grilling (proposer↔adversary, mediated), APPROVE-WITH-FIXES with
no Floor breach, empirically validated by `strace` of the real indicators venv (numpy 2.4.3 / pandas
3.0.1). Cites `recon.md`. Written by /sdd-design Phase 1._

## Chosen Approach — unprivileged in-container OS isolation of the formula child

Harden the **existing** subprocess formula child (recon Codebase Map; keep `_sandbox_env()`, the
`SandboxResult`/`exit_reason` contract, the import allow-list, and `RLIMIT_DATA`) with four layered,
unprivileged mechanisms that all run **on DO App Platform as-is** (operator decision: stay on App
Platform, no `CAP_SYS_ADMIN`/namespaces/jailer). No proto change; no new consumer surface.

### 1. Distinct-UID child (the load-bearing containment)
The container keeps running as **root** (no `USER` in the Dockerfile) so it can drop the child to a
dedicated unprivileged UID. The child, before running untrusted code, does — **in the wrapper's own
single main thread, post-`execve`** (NOT `preexec_fn` — see Rejected #4):
`setgid(65534) → setgroups([]) → setuid(65534) → prctl(PR_SET_NO_NEW_PRIVS,1) → setrlimit(...) →
eagerly import numpy/pandas → seccomp.load() → exec(untrusted source)`.
Running as a **different UID than the parent** is what makes the isolation real: the kernel blocks a
cross-UID `process_vm_readv` of the parent's in-memory secrets and a cross-UID read of the parent's
`/proc/<pid>/environ` (→ `EACCES`), which an in-container **same-UID** seccomp filter could not (round-1
SEV-1). Defense in depth: the platform's real secrets are `GetSecret`-RPC config rows, **not** files in
this container, and `_sandbox_env()` already strips them from the child env (`sandbox.py:43-55`).

### 2. Source via stdin, no temp file
Replace the `NamedTemporaryFile` launch (`sandbox.py:189-200,264-268`) with
`subprocess.Popen([sys.executable, "-"], input=wrapped, start_new_session=True, ...)`: the wrapped
program is fed on **stdin** (an inherited fd, UID-independent). This removes the parent-owned `/tmp`
script the nobody child otherwise could not read, and eliminates the sibling read-exfil surface
(round-1 SEV-3) wholesale.

### 3. Seccomp-BPF **allowlist**, `defaction=ERRNO(EPERM)`, native arch only — loaded *after* import
Loaded **inside the wrapper, after** numpy/pandas import + BLAS thread-pin (`sandbox.py:34-40`) and
immediately **before** `exec(untrusted)`. This shrinks the surface to *compute-only* (imports already
done) and drops `execve`/startup syscalls from the set. An allowlist **fails closed**: compat x86/x32
arches (never added), `io_uring_*`, and any unknown/new syscall all fall to `EPERM` automatically — no
per-arch bookkeeping, closing the round-1 denylist bypasses (io_uring, 32-bit ABI, pidfd). `.load()` as
`nobody` needs no capability because `PR_SET_NO_NEW_PRIVS` is set first (pyseccomp sets it by default —
**invariant: must not disable it**).

**The allow set (empirically finalized from `strace` of real compute + defensive read-path members):**
`openat, read, readv, write, writev, close, lseek, fstat, newfstatat, statx, getdents64, mmap, munmap,
mremap, mprotect, madvise, brk, mbind, set_mempolicy, get_mempolicy, futex, futex_waitv,
set_robust_list, get_robust_list, rseq, sched_yield, sched_getaffinity, membarrier, clone, clone3,
rt_sigaction, rt_sigprocmask, rt_sigreturn, rt_sigtimedwait, sigaltstack, restart_syscall, tgkill,
clock_gettime, clock_nanosleep, nanosleep, gettimeofday, getrandom, getpid, gettid, getuid, geteuid,
getgid, getegid, prctl, exit, exit_group`.
- **`mbind`** (+`set_mempolicy`/`get_mempolicy`) — empirically observed on an 800×800 matmul (NUMA
  memory policy); **not** on 200×200, which is why the frozen golden must use realistically-large
  arrays (Open Risk O-1).
- **`statx` + `getdents64`** — defensive: the runtime `python:3.13-slim` glibc may route the stat
  family through `statx` and a cold `FileFinder` dir-walk of a lazily-imported submodule fires
  `getdents64` (fails.md:369 — trace host ≠ runtime image). Both read-path, inert to network/exec.
- **`openat` is read-used**; file *creation* is prevented by env (mechanism 4) + `RLIMIT_FSIZE=0`.

**Deliberately EXCLUDED → `EPERM`:** the whole **network** family (`socket`/`socketcall`/`connect`/
`bind`/`listen`/`accept*`/`sendto`/`sendmsg`/`recvfrom`/`recvmsg`), `execve`/`execveat`, `io_uring_*`,
`ptrace`, `process_vm_readv`/`writev`, `pidfd_*`, `ioctl` (the `isatty`/`TIOCGWINSZ` probes tolerate
`EPERM` identically to the `ENOTTY` they already get — verified), and all write-creating FS ops
(`mkdir`/`rename`/`unlink`/…). `clone`/`clone3` stay **allowed** (numpy/BLAS threads); a forked child
is inert because `execve` is denied and process count is `RLIMIT_NPROC`-bounded.

### 4. Expanded rlimits + env write-elimination
In the child, after `setuid`: keep `RLIMIT_DATA` (`sandbox.py:127-128`; **no `RLIMIT_AS`** — it rejects
numpy's large virtual reservations, breaking FR-4 per the existing docstring), add `RLIMIT_CPU =
ceil(timeout_ms/1000)+2` (SIGKILL-independent CPU backstop), `RLIMIT_NPROC = max_concurrent × 16`
(bounds fork-bombs; derived from the existing `indicators.sandbox.max_concurrent` so it scales and
can't drift), `RLIMIT_FSIZE = 0` (write-content bound; stdout is a pipe, unaffected), `RLIMIT_NOFILE =
64`. Add to `_sandbox_env()` (`sandbox.py:43-55`): **`PYTHONDONTWRITEBYTECODE=1`** and
**`HOME=/nonexistent` + `TMPDIR=/nonexistent`** — empirically these eliminate *every* compute-time
write (`.pyc` caching + any `~/.cache`/`$TMPDIR` vector): the 800×800 trace under these env vars showed
zero `mkdir`/`rename`/`openat(O_WRONLY)`. This closes the "file creation via allowed `openat`" residual
(round-4 SEV) cleanly, with `RLIMIT_FSIZE=0` as the backstop.

### 5. Deterministic termination
`Popen(start_new_session=True)` + `communicate(timeout)`; on `TimeoutExpired`, `os.killpg(getpgid,
SIGKILL)` then reap — on **timeout and on every execution exit**. This is **load-bearing** (round-3
SEV): a `fork()+sleep(∞)` grandchild survives both the direct-child SIGKILL and `RLIMIT_CPU` (burns no
CPU) and would hold a uid-65534 `RLIMIT_NPROC` slot forever → accumulate → permanent @AC-5 DoS. The
process-group kill is what makes the NPROC bound actually hold.

### 6. Config + exit mapping (no proto, no new leaves)
Every rlimit derives from the two existing tunables (`indicators.sandbox.timeout_ms`,
`indicators.sandbox.max_concurrent`, `.memory_bytes` — `watcher.py:128-144`) or is a named safety
constant (`×16`, `+2`, `FSIZE=0`, `NOFILE=64`, uid/gid `65534`) with a ≤2-line constraint note at its
definition (C-18/root How-to-Act #5). **No new `indicators.sandbox.*` leaves** (reverses recon Scope
(e) — a new leaf would duplicate existing keys or expose a knob with no requirement; a `seccomp_enabled`
kill-switch is rejected because it would let prod disable the primary control). A seccomp/rlimit/uid
denial → the existing default `exit_reason="runtime_error"` → existing `SANDBOX_EXIT_REASON_RUNTIME_ERROR`
(`servicer.py:181-187`); timeout→`timeout`, `RLIMIT_DATA` MemoryError→`memory_exceeded`. **No proto
change** (honors product-spec `:83-85`).

### Dependency + verification
- `pyseccomp` added to `pyproject.toml` + **`uv lock`** committed same PR (else `python-lint uv
  lock --check` fails); Dockerfile: `apt-get install libseccomp2` (runtime) + `libseccomp-dev gcc`
  (build, purged after `uv sync`). No `USER` line (stays root for setuid).
- **Remove `app/services/sandbox.py` from the `[tool.coverage.run] omit`** (`pyproject.toml:40-46`) —
  the security change must be measured — and re-check the ≥50% gate (fails.md:133/R5).
- Verification is privilege-split (fails.md:369): (a) an **always-run** structural filter assertion
  (pyseccomp is a hard dep → `ImportError` not `importorskip` if missing) that goes **RED** if a denied
  syscall is added to the allow set (P-06); (b) a **frozen numpy/pandas golden run through the real
  loaded filter** covering large-array/`linalg`/`fft`/`groupby`/`rolling`/RNG paths (the FR-4/@AC-7
  net; `setuid` step gated on `geteuid()==0` and **recorded, never silent-skipped**, when unprivileged);
  (c) an @AC-5 concurrency starvation test that also asserts a fork-bomb child does not permanently
  break later executions (killpg reclaim); (d) @AC-4 empty-`allowed_imports` still `import_blocked`;
  (e) the real setuid+seccomp+rlimit stack exercised **inside the runtime image** in CI/deploy.

## Rejected Alternatives
1. **Jailer (nsjail/bubblewrap/gVisor) + namespaces** — needs `CAP_SYS_ADMIN`/userns/privileged, not
   granted on DO App Platform; would force re-hosting indicators (Droplet/DOKS) — large deploy blast
   radius. Operator chose to stay on App Platform. (recon R2.)
2. **In-container seccomp with the child on the *same* UID** — leaves the parent's in-memory secrets
   readable via `process_vm_readv`/`/proc/environ` by a same-UID escapee (round-1 SEV-1). Distinct-UID
   is required for the FR-2 "no secret access" objective.
3. **Seccomp denylist** (default-allow; deny network+exec families) — round-1 showed a hand denylist
   leaves io_uring/32-bit-ABI/pidfd open (fails **open**); the allowlist fails **closed** and, loaded
   post-import, its FR-4 fragility is small and **testable** via the golden (round-3 decisive call).
4. **`preexec_fn` for the lockdown** — CPython documents it as unsafe with threads; this service is
   multithreaded (`asyncio.to_thread`/grpc.aio/OTel), so a libc/GIL call in the forked child can
   deadlock → flaky concurrent failures (round-2 SEV). In-wrapper post-`execve` lockdown (single-
   threaded child) avoids it and needs no raw-syscall/`export_bpf` gymnastics.
5. **Per-slot UIDs** (one uid per concurrent slot) — gives true per-child `RLIMIT_NPROC` isolation but
   needs a uid pool + allocator; the single-distinct-uid residual is timeout+killpg-bounded. Recorded
   as the escape hatch if NPROC starvation ever bites (Open Risk O-2).
6. **`SCMP_ACT_KILL` default** — a mis-scoped filter SIGSYS-kills a legit formula grazing a harmless
   omitted syscall (FR-4 risk); `ERRNO(EPERM)` lets libraries probe-and-fall-back. Cost: a
   completeness miss reads as a generic `runtime_error` (raises the golden's importance — O-1).
7. **Flag-filtered `openat` (deny `O_WRONLY|O_CREAT`)** — fragile (flag combos, `openat2` bypass),
   C-18 complexity; the `HOME`/`TMPDIR`=nonexistent env fix + `RLIMIT_FSIZE=0` is simpler and
   sufficient.
8. **New `indicators.sandbox.*` config leaves for the rlimits** — YAGNI; all derive from existing keys
   or are safety constants (C-18).

## Open Risks (→ context.md Open Threads)
- **O-1 (allowlist FR-4 fragility).** The golden only catches a syscall regression for the paths it
  pins; a numpy/pandas bump could add a compute syscall on an unexercised path → prod `EPERM` →
  `runtime_error`. Mitigation: golden **breadth** — large arrays (to hit `mbind`), `linalg`/`fft`,
  `groupby`/`rolling`, RNG. Target step: the Step-6-equivalent test step. Accepted residual cost of
  fail-closed over denylist.
- **O-2 (single-UID cross-child NPROC starvation).** All children share uid 65534, so `RLIMIT_NPROC`
  is a shared per-uid ceiling; a thread-heavy child can `EAGAIN` a sibling. Bounded (offender killed +
  killpg reclaim). Escape hatch: per-slot UIDs (Rejected #5). Target step: the @AC-5 concurrency test
  asserts no permanent breakage.
- **O-3 (verification env ≠ runtime).** The strace/golden ran on the design host, not
  `python:3.13-slim`; `statx`/`getdents64` were added defensively for that reason. The runtime-image
  syscall validation (verification e) must run in CI/deploy.

## Constitution Rules Touched
- **C-16** (@AC-4 import-deny, @AC-5 concurrency+timeout, @AC-7 numeric parity) — PRESERVE guards; the
  golden + concurrency + empty-imports tests are their regression nets.
- **F-07 / C-05** — no hardcoded config; rlimits derive from WatchConfig tunables; safety constants are
  engine invariants (precedent: `MAX_PARAMETERS`), not tunables — no new leaf.
- **C-08 / P-06** — paired RED-demonstrating deny-test; coverage-omit removed so the security code is
  measured.
- **C-18** — no new proto/leaves/mechanism beyond need; `ERRNO`-default + env-fix chosen over
  arg-filtered `openat`/per-syscall errno.
- **C-14** — consumer surface none (internal); tool/RPC behavior unchanged (FR-4).
- **Floor:** none breached across 4 rounds.
