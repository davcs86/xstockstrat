# xstockstrat-indicators — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — CLAUDE.md banner row partially resolved; inert-seed row notes the stale "memory cap" descriptions; `timeout_ms_override` anchor deduped; line hints re-stamped). For triage/fixing, not
governance. The fictional ledger/notify dependency is a repeated pattern also recorded at the root.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Sandbox top-of-file comments say `RLIMIT_AS` | Code uses `RLIMIT_DATA` (INDICATORS-2); only the wrapper docstring is correct | `app/services/sandbox.py:17-18,34-36` vs `:125` | Fix the stale comments (a skim gives the wrong invariant) — **resolved (feature 209):** the sandbox docstring and comments now state `RLIMIT_AS` is deliberately not used (`sandbox.py:22-25,279-280`; re-anchored feature 228) |

**Resolved (2026-08-09 refresh):**
- ~~CLAUDE.md lists `ledger` + `notify` gRPC deps, a "Ledger Events Emitted" table, and `LEDGER_ENDPOINT`/`NOTIFY_ENDPOINT` env vars~~ — confirmed fixed by the pre-Aug-2 PgBouncer-routing commits: current CLAUDE.md's Dependencies table lists only `xstockstrat-config` and TimescaleDB; grepped `CLAUDE.md` for `ledger|notify`, zero live deps/env-var references remain. (Feature 224 later added a **real** ledger dependency — `audit.admin_read` appends via `LEDGER_ENDPOINT`, `app/main.py`, `app/admin_audit.py` — now listed in CLAUDE.md.)
- ~~CLAUDE.md: `asyncpg.create_pool(..., min_size=2, max_size=10)`~~ — confirmed fixed: current `CLAUDE.md` reads `min_size=1, max_size=int(os.environ.get("DB_POOL_MAX", "2"))`, matching `app/main.py` verbatim.
- ~~`indicators.sandbox.max_concurrent` (default 4) documented as "Max concurrent sandbox executions"~~ — no longer a doc-lie: CLAUDE.md's own config table now self-flags it ("**Documented, not yet enforced** — intended concurrency cap; no `Semaphore`/limit reads it"). The underlying gap (no concurrency limit in code) is still open as an implementation task, not a documentation defect. **Superseded (feature 176/209):** the cap is now enforced — `asyncio.Semaphore(max(1, config_watcher.sandbox_max_concurrent()))` (`servicer.py:102`, acquired in `ExecuteFormula`); the "not yet enforced" flag no longer applies.
- ~~The untrusted sandbox child inherits the parent's full `os.environ` (incl. `DATABASE_URL`, secrets)~~ — **resolved (2026-09-16 security audit, C-4)**: the child now runs with a minimal env (`_sandbox_env()` — `PYTHONPATH` + the BLAS/OMP thread pins only), so an escaped formula has no platform secrets in its environment to exfiltrate. Covered by `tests/test_sandbox.py::TestSandboxEnvIsolation`. The deeper in-process-sandbox escapability (no AST allowlist) remains open — tracked as the sandbox OS-isolation design item in the security audit report.

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — The sandbox writes the wrapped formula to a `NamedTemporaryFile(delete=False)` on shared disk, and the in-process builtins sandbox has no AST allowlist, so a deliberate formula can escape `exec` and gain filesystem/network access despite the "no filesystem/network" posture. (The parent-env inheritance sub-issue was fixed 2026-09-16 — see Resolved above; the child env is now minimal.) The real remedy is OS-level isolation (nsjail/gVisor/locked container) — tracked as a design item in the 2026-09-16 security audit report. **Superseded (feature 209):** the temp file is gone (the wrapped source is fed on stdin, `app/services/sandbox.py:363-374`), and the OS-level isolation landed (distinct UID, seccomp allowlist with no file-open syscalls, rlimits; `CLAUDE.md` § Sandbox Security Model, INDICATORS-6..9) — status: **resolved (feature 209)**
- Sandbox failure classification greps child **stderr** for `"is not allowed in sandbox"` and the two `_MEMORY_EXHAUSTED_MARKERS` (`"MemoryError"`, `"OpenBLAS error: Memory allocation still failed"`, feature 228) — a formula that prints/raises those exact strings is mis-tagged as `import_blocked`/`memory_exceeded`. Is string-matching the intended discriminator (vs a structured exit code)? `app/services/sandbox.py:201,402-407` — status: **open**
- `SandboxResult.memory_used_bytes` is hardcoded to `0` on every path and surfaced verbatim in the RPC response — is memory accounting deliberately unimplemented, or is a consumer expecting a real number? `app/services/sandbox.py:387,414,425`, `servicer.py:325,341` — status: **open**
- **Inert indicators seeds.** Config migrations `services/xstockstrat-config/migrations/001_config_tables.up.sql:63` and `002_config_environment.up.sql:62` seed bare `sandbox.*` keys, but the watcher reads full-dotted `indicators.sandbox.*` (`app/config/watcher.py:134,138,143`; CONFIG-9 — no namespace auto-prefix), so they never applied; production's 64 MiB seed was inert. Both seed descriptions (`'Formula memory cap bytes'`, `'… (64MB)'`) called the value a memory cap, while since feature 228 it is headroom above the measured `VmData` baseline (INDICATORS-2). Config migration `031_heal_indicators_sandbox_keys_full_dotted.up.sql` heals the rows to `indicators.sandbox.*` at 5000 / 134217728 / seed imports and rewrites the `memory_bytes` descriptions to the headroom wording; 001/002 stay untouched (F-01). — status: **resolved (feature 243)**
- **Unclamped override.** `memory_bytes_override` is unclamped (`servicer.py:278`; D-33 in `docs/repo-surveyor/debt-radar-findings.md:315`). Feature 228 only clamps the computed cap to int64 (`sandbox.py:283`); a negative override still skips the `RLIMIT_DATA` setrlimit (`sandbox.py:282`). — status: **fixed on `hotfix/fix-sandbox-overrides-unclamped`** (`servicer.py#_clamp_override`: positive override → `min(override, config)`, `≤ 0` → config)
- **Wording drift.** The durable suite `acceptance/indicators-sandbox-os-isolation.feature:29` says "address-space for the allocation", but the cap is `RLIMIT_DATA` (data segment, `sandbox.py:284`). Record only; C-16 forbids hand-editing the durable suite. — status: **open**
- Is `timeout_ms_override` (and, per the entry above, `memory_bytes_override`) meant to be unbounded for any authenticated caller? It replaces config with no clamp and `RLIMIT_CPU` derives from it. `app/handlers/servicer.py#ExecuteFormula` (~L277-278) — status: **answered: no** — clamped to the config value by `_clamp_override` (`hotfix/fix-sandbox-overrides-unclamped`)
- ⚠ **unverified** — `_load_formula` serves from the process-local `self._formulas` cache, invalidated only by local `pop`s; with more than one replica an Update/Delete on A leaves B executing stale (or soft-deleted) source. Replica count not checked (`.do/app*.yaml`). `app/handlers/servicer.py#_load_formula` — status: **open**
- `_flt.add_rule` failures are swallowed (`except Exception: pass`); is there an image-level test that fails when `_SECCOMP_ALLOW` holds an unknown syscall name? `app/services/sandbox.py#_SECCOMP_ALLOW` — status: **open**

## Documentation that lies — additions (2026-10-14)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `ATR` reads as one indicator platform-wide | "ATR" means two numbers: the indicators built-in `ATR` is a close-to-close approximation (rolling mean of `\|Δclose\|`), while trading's position sizing computes true Wilder ATR(14) from OHLC bars | `app/services/indicators_engine.py` `INDICATOR_REGISTRY["ATR"]`; `services/xstockstrat-trading/internal/service/trading.go#wilderATR` (`:3169-3198`, called as `wilderATR(recentBars, 14)` `:3232`) | Feature 268 (D-18 Option A) renamed the description only, values unchanged; do not compare or substitute the two. True OHLCV ATR/VWAP is a proto change (`ComputeIndicatorRequest` has only `values`) — status: **open (documented)** |
| `CLAUDE.md` env block lists `TRADING_MODE=paper` (partially resolved 2026-10-19: the banner no longer lists "⚠ sandbox env inheritance" — fixed by `0aa9c04`) | `TRADING_MODE` is the repo-wide docs-vs-code disagreement in the root findings log | `services/xstockstrat-indicators/CLAUDE.md` env block (`TRADING_MODE=paper`, ~L206); `app/config/watcher.py` | Refresh the env block |


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-indicators-acceptance-rlimit-wording-defect`](../../../docs/reports/2026-10-19-indicators-acceptance-rlimit-wording-defect.md) | Sandbox OS-isolation acceptance suite says "address-space" for the RLIMIT_DATA cap |
| [`2026-10-19-indicators-sandbox-overrides-unclamped-defect`](../../../docs/reports/2026-10-19-indicators-sandbox-overrides-unclamped-defect.md) | ExecuteFormula timeout/memory overrides are unclamped (sandbox slot exhaustion) |
| [`2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect`](../../../docs/reports/2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect.md) | Indicators sandbox config seeds use bare keys and never apply |
| [`2026-10-19-sandbox-exit-reason-stderr-substring-defect`](../../../docs/reports/2026-10-19-sandbox-exit-reason-stderr-substring-defect.md) | Sandbox exit reason is classified by stderr substring match |
| [`2026-10-19-sandbox-memory-used-bytes-always-zero-defect`](../../../docs/reports/2026-10-19-sandbox-memory-used-bytes-always-zero-defect.md) | SandboxResult.memory_used_bytes is always zero |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
