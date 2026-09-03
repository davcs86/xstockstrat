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
| **INDICATORS-1** | **Pin BLAS/OMP/MKL/NUMEXPR/VECLIB thread counts to 1 in the child subprocess env, *before* numpy is imported** (passed via `subprocess.run(env=...)`, not set inside the formula). | Numeric libs spawn one worker thread per core on import, each reserving a large buffer that overflows the sandbox rlimit → `OpenBLAS error: Memory allocation still failed after 10 retries`. Days lost to a "flaky sandbox." | `_THREAD_LIMIT_ENV` `app/services/sandbox.py:40-46`, applied `:206-210`; PR #663 | `app/services/sandbox.py:40-46` |
| **INDICATORS-2** | **The sandbox memory cap uses `RLIMIT_DATA`, never `RLIMIT_AS`.** | `RLIMIT_AS` counts virtual address space, which numpy/pandas over-reserve on import (hundreds of MiB never resident) → the 128 MiB cap rejects pandas with `MemoryError` before any real allocation. `RLIMIT_DATA` tracks actual allocation, keeping the budget enforceable. | `app/services/sandbox.py:125`; PR #663 | `app/services/sandbox.py:125` |
| **INDICATORS-3** | **Deserialize a protobuf `Struct` with `MessageToDict()`, never `dict()`.** | `dict()` unwraps only the top level; nested `ListValue`/`Struct` fields stay as protobuf objects and crash the sandbox at `json.dumps(input_data)` with "Object of type ListValue is not JSON serializable". | `app/handlers/servicer.py:143`; `app/services/parameters.py:50,137`; PR #650 | `app/handlers/servicer.py:143` |
| **INDICATORS-4** | **Restricted builtins are built by copying a safe subset into a fresh `__builtins__`, never by deleting names off the shared `builtins` module.** | Mutating/`del`-ing names off `builtins` breaks the interpreter (import machinery, `delattr`) so even `result = 1` fails with `NameError`. | `app/services/sandbox.py:113-153` | `app/services/sandbox.py:113-153` |
| **INDICATORS-5** | **Header authz is read per-method off `context.invocation_metadata()` (admin = `x-access-scope & 0x04`; author = `x-user-id`) — there is no interceptor.** | Python services thread propagation per method (not via a Go-style interceptor); this service only *reads* inbound metadata and makes no outbound per-request calls. | `app/handlers/servicer.py:36` (`_has_admin_scope`), author read `:225-230` | `app/handlers/servicer.py:36` |

## Gotchas & scars

- **The seed formula id is a deterministic UUIDv5 that xstockstrat-analysis consumes as config.** `FORMULA_ID = d1ff5e6b-6d9c-589d-b95e-defd862c702b` (`app/formulas/fundamentals_value_quality.py`, seeded `app/services/seed_formulas.py:35`) is read by analysis as `analysis.fundsignal.scoring_formula_id` (feature 062). Changing the UUID or the `SYSTEM_AUTHOR` breaks the cross-service link. Evidence: `servicer.py:322,422`.
- **A stored formula that declares `outputs` must emit every series or the run fails; inline `formula_source` runs are exempt.** `value` is the reserved implicit primary series. Evidence: `servicer.py:157-172`, `parameters.py:32,94`.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| Sandbox failure classification by stderr substring-match is a fixed contract | `sandbox.py:229-232` matches `"is not allowed in sandbox"`/`"MemoryError"` | a maintainer ruling (a formula printing those strings is mis-tagged — see findings open question) |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Sandbox security model overview | `CLAUDE.md:78-89` |
| `MAX_PARAMETERS=32` / `MAX_OUTPUTS=16`, `value` reserved | `app/services/parameters.py:28-32`; `CLAUDE.md:109,120` |
| Coverage ≥50% (`--cov-fail-under=50`); ruff `E,F,I,UP` line-length 100 | `CLAUDE.md:157`; `pyproject.toml` |
| Config subscribe + 90s snapshot before serving | `app/main.py:45-47`, `app/config/watcher.py:51-58` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
