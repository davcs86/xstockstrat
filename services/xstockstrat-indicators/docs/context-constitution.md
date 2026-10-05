# xstockstrat-indicators — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549` — no source change since last forge; `servicer.py`
line anchors for INDICATORS-3/-5 re-grounded). Captures the **non-obvious** local
invariants of the indicators service (formula engine + subprocess-isolated sandbox, gRPC 50054). The
sandbox is the security crown jewel — most rules here protect it. Does not restate documented/CI-enforced
rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-indicators**.

## Rules (`INDICATORS-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **INDICATORS-1** | **Pin BLAS/OMP/MKL/NUMEXPR/VECLIB thread counts to 1 in the child subprocess env, *before* numpy is imported** (passed via the `_sandbox_env()` dict, not set inside the formula). | Numeric libs spawn one worker thread per core on import, each reserving a large buffer that overflows the sandbox rlimit → `OpenBLAS error: Memory allocation still failed after 10 retries`. Days lost to a "flaky sandbox." | `_THREAD_LIMIT_ENV` `app/services/sandbox.py:44-52`, applied in `_sandbox_env` `:80-95`; PR #663 | `app/services/sandbox.py:44-52` |
| **INDICATORS-2** | **The sandbox memory cap uses `RLIMIT_DATA`, never `RLIMIT_AS`.** | `RLIMIT_AS` counts virtual address space, which numpy/pandas over-reserve on import (hundreds of MiB never resident) → the 128 MiB cap rejects pandas with `MemoryError` before any real allocation. `RLIMIT_DATA` tracks actual allocation, keeping the budget enforceable. | `app/services/sandbox.py:258` (RLIMIT_DATA in the wrapper; "not RLIMIT_AS" note `:254-255`); PR #663 | `app/services/sandbox.py:258` |
| **INDICATORS-3** | **Deserialize a protobuf `Struct` with `MessageToDict()`, never `dict()`.** | `dict()` unwraps only the top level; nested `ListValue`/`Struct` fields stay as protobuf objects and crash the sandbox at `json.dumps(input_data)` with "Object of type ListValue is not JSON serializable". | `app/handlers/servicer.py:131`; `app/services/parameters.py:50,137`; PR #650 | `app/handlers/servicer.py:131` |
| **INDICATORS-4** | **Restricted builtins are built by copying a safe subset into a fresh `__builtins__`, never by deleting names off the shared `builtins` module.** | Mutating/`del`-ing names off `builtins` breaks the interpreter (import machinery, `delattr`) so even `result = 1` fails with `NameError`. | `app/services/sandbox.py:220-234` (`_restricted_builtins`) | `app/services/sandbox.py:226` |
| **INDICATORS-5** | **Header authz is read per-method off `context.invocation_metadata()` (admin = `x-access-scope & 0x04`; author = `x-user-id`) — there is no interceptor.** | Python services thread propagation per method (not via a Go-style interceptor); this service only *reads* inbound metadata and makes no outbound per-request calls. | `app/handlers/servicer.py:36` (`_has_admin_scope`), author read `:225-230` | `app/handlers/servicer.py:36` |
| **INDICATORS-6** | **The sandbox child must run as a DISTINCT UID (nobody 65534) — the container therefore runs as root (no `USER` in the Dockerfile) so the child can `setuid` down.** | A same-UID seccomp filter cannot block `process_vm_readv` / `/proc/<parent>/environ` reads of the parent's in-memory secrets; cross-UID is what closes that. Adding a `USER` line removes the root parent and silently breaks the drop (feature 209). | `setuid(65534)` `app/services/sandbox.py:247-249`; Dockerfile has no `USER`; feature 209 design §1 | `app/services/sandbox.py:247-249` |
| **INDICATORS-7** | **The seccomp filter is an ALLOWLIST (`defaction=ERRNO(EPERM)`, native arch only) loaded AFTER the numeric-lib import and immediately BEFORE `exec(source)` — never before `execve`, never a denylist.** | Post-import shrinks the surface to compute-only, and **no file-open syscall (`openat` etc.) is allowed**, because module-attribute traversal reaches the real `os` past the import guard. Allowed modules' lazy attributes must therefore be resolved before the load. An allowlist fails **closed** (compat x86/x32 arches + io_uring + unknown syscalls → EPERM), where a denylist fails open on a forgotten bypass. `_SECCOMP_ALLOW` is the audited set (feature 209). | `_SECCOMP_ALLOW` `app/services/sandbox.py:61`; build+load `:266-269`; feature 209 design §3 | `app/services/sandbox.py:61` |
| **INDICATORS-8** | **`PR_SET_NO_NEW_PRIVS` must stay set before the seccomp load — never disable it.** | An unprivileged `seccomp()` filter load requires `no_new_privs` (else EACCES); `pyseccomp` sets it by default on `.load()` and the wrapper also sets it explicitly. Disabling it breaks the nobody-child load. | `prctl(38, 1, …)` `app/services/sandbox.py:252` | `app/services/sandbox.py:252` |
| **INDICATORS-9** | **`Popen(start_new_session=True)` + `killpg(SIGKILL)` on timeout AND in `finally` is load-bearing, not just for timeouts.** | A `fork()+sleep(∞)` grandchild survives the direct-child kill and `RLIMIT_CPU` (burns no CPU) and would hold a uid-65534 `RLIMIT_NPROC` slot forever → permanent DoS. The process-group kill is what makes the NPROC bound hold (feature 209). | `_killpg` `app/services/sandbox.py:287-296`; `start_new_session` `:343`; `finally` reap | `app/services/sandbox.py:287-296` |

## Gotchas & scars

- **The seed formula id is a deterministic UUIDv5 that xstockstrat-analysis consumes as config.** `FORMULA_ID = d1ff5e6b-6d9c-589d-b95e-defd862c702b` (`app/formulas/fundamentals_value_quality.py`, seeded `app/services/seed_formulas.py:34`) is read by analysis as `analysis.fundsignal.scoring_formula_id` (feature 062). Changing the UUID or the `SYSTEM_AUTHOR` breaks the cross-service link. Evidence: `servicer.py:322,422`.
- **A stored formula that declares `outputs` must emit every series or the run fails; inline `formula_source` runs are exempt.** `value` is the reserved implicit primary series. Evidence: `servicer.py:157-172`, `parameters.py:32,94`.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| Sandbox failure classification by stderr substring-match is a fixed contract | `sandbox.py:229-232` matches `"is not allowed in sandbox"`/`"MemoryError"` | a maintainer ruling (a formula printing those strings is mis-tagged — see findings open question) |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Sandbox security model overview | `CLAUDE.md` § Sandbox Security Model |
| `MAX_PARAMETERS=32` / `MAX_OUTPUTS=16`, `value` reserved | `app/services/parameters.py:28-32`; `CLAUDE.md:109,120` |
| Coverage ≥50% (`--cov-fail-under=50`); ruff `E,F,I,UP` line-length 100 | `CLAUDE.md:157`; `pyproject.toml` |
| Config subscribe + 90s snapshot before serving | `app/main.py:45-47`, `app/config/watcher.py:50-57` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
