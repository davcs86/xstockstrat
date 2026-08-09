# xstockstrat-indicators — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The fictional ledger/notify dependency is a repeated pattern also recorded at the root.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `indicators.sandbox.max_concurrent` (default 4) documented as "Max concurrent sandbox executions" | No `Semaphore`/concurrency limit anywhere | `CLAUDE.md` config table (grep zero) | Implement the limit or delete the key |
| Sandbox top-of-file comments say `RLIMIT_AS` | Code uses `RLIMIT_DATA` (INDICATORS-2); only the wrapper docstring is correct | `app/services/sandbox.py:17-18,34-36` vs `:125` | Fix the stale comments (a skim gives the wrong invariant) |

**Resolved (2026-08-09 refresh):**
- ~~CLAUDE.md lists `ledger` + `notify` gRPC deps, a "Ledger Events Emitted" table, and `LEDGER_ENDPOINT`/`NOTIFY_ENDPOINT` env vars~~ — confirmed fixed by the pre-Aug-2 PgBouncer-routing commits: current CLAUDE.md's Dependencies table lists only `xstockstrat-config` and TimescaleDB; grepped `CLAUDE.md` for `ledger|notify`, zero live deps/env-var references remain.
- ~~CLAUDE.md: `asyncpg.create_pool(..., min_size=2, max_size=10)`~~ — confirmed fixed: current `CLAUDE.md` reads `min_size=1, max_size=int(os.environ.get("DB_POOL_MAX", "2"))`, matching `app/main.py` verbatim.

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — The sandbox writes the wrapped formula to a `NamedTemporaryFile(delete=False)` on shared disk and runs the untrusted child with the parent's **full `os.environ`** (incl. `DATABASE_URL`, secrets), despite the "no filesystem/network" posture. Is inheriting the parent env into the untrusted child intended? `app/services/sandbox.py:195,207-208` — status: **open**
- Sandbox failure classification greps child **stderr** for `"is not allowed in sandbox"`/`"MemoryError"` — a formula that prints/raises those exact strings is mis-tagged as `import_blocked`/`memory_exceeded`. Is string-matching the intended discriminator (vs a structured exit code)? `app/services/sandbox.py:229,231` — status: **open**
- `SandboxResult.memory_used_bytes` is hardcoded to `0` on every path and surfaced verbatim in the RPC response — is memory accounting deliberately unimplemented, or is a consumer expecting a real number? `app/services/sandbox.py:239,250,263`, `servicer.py:170,186` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
