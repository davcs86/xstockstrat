# xstockstrat (root) — Constitution Findings

Defects and drift surfaced by `/context-constitution` (context-forge) on 2026-07-24 while deriving the
constitution — the things an agent trusting the docs or the surface would get **wrong**. These are for
triage/fixing (feed them to your issue tracker), not governance: a defect is not a rule. Every entry
cites the code. Refresh by re-running `/context-constitution`.

This root log holds **repo-wide / repeated** defects (the same defect in N modules is recorded once
here, not N times — per the monorepo reconciliation pass). Module-specific defects live in each
module's `context-constitution-findings.md`.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `docs/patterns/observability.md` states all services push OTLP to `otel-collector:4317` | 5 Node/Next services actually export to `:4318` (OTLP/HTTP); the split is by runtime (constitution PLAT-3) | `observability.md:5,16` vs `docker-compose.yml:119,150,182,216,470` | Correct the doc to encode the 4317-gRPC / 4318-HTTP split |
| Root `CLAUDE.md` §Header Propagation says Node services thread `x-user-id/...` via **AsyncLocalStorage** | `middleware/propagation.ts` (`propagationStore`, `extractFromHttpRequest`) has **zero** importers in all 4 Node services; the comment references the removed Connect-RPC HTTP path | `services/xstockstrat-{ledger,identity,notify,config}/src/middleware/propagation.ts` (grep: only self-references) | Delete the dead module and scope the doc rule to outbound-per-request callers (constitution PLAT-4) |
| All 3 Go service CLAUDE.md files say **"Go 1.22"** | `go.mod` is `go 1.25.0`, Dockerfiles `FROM golang:1.25-alpine`, root table pins Go 1.25 | `services/xstockstrat-{trading,portfolio,marketdata}/CLAUDE.md` "Go 1.22" vs each `go.mod:3` | ✓ **RESOLVED** (2026-08-02 refresh) — all three service CLAUDE.md now read "Go 1.25" |
| notify/identity/indicators/ingest CLAUDE.md list a **ledger/notify gRPC dependency** + "Ledger Events Emitted" tables + `LEDGER_ENDPOINT`/`NOTIFY_ENDPOINT` env vars | No ledger/notify client code exists in any of them; the env vars are read by no code; events are only `log.info` lines (or nothing) | notify `CLAUDE.md:39,57`; identity `CLAUDE.md:45,89`; indicators `CLAUDE.md` deps table; ingest `CLAUDE.md` "Ledger Events Emitted" — all grep-zero in `src/`/`app/` | ✓ **RESOLVED** (2026-08-02 refresh) — identity/notify/indicators dropped the fictional deps; ingest now genuinely emits (`ingest/app/handlers/servicer.py:254,278,806` — ledger `AppendEvent`/notify `EmitAlert`), so its deps are real |
| Several Node service CLAUDE.md say **"Node.js 20"** and pin `@types/node ^20` | Root standardizes on Node 22 | `services/xstockstrat-{ledger,identity,notify,config}/CLAUDE.md:9` + `package.json` `@types/node ^20` | ◐ **PARTIAL** (2026-08-02 refresh) — CLAUDE.md Language lines now say "Node.js 22"; the `@types/node ^20` pin still remains in all four `package.json` |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **Python config zero-trap is a consumer defect** (CF-N10): `get_int/get_str/get_float` use `v.int_val or default`, collapsing a legitimate stored `0`/`""` to the default, even though `config.ConfigValue` is a `oneof` that distinguishes 0 from unset and the Node getter (`??`) handles it correctly. | Setting any Python-consumed int/float/str key to `0`/`""` silently reverts to the coded default (e.g. `analysis.scoring.shrinkage_days=0`, chunk sizes, timeouts). Recorded as a constitution *gotcha* too (current behavior), and here as the fix. | `services/xstockstrat-indicators/app/config/watcher.py:66,74,90`; `ingest/app/config/watcher.py:60-90`; `analysis/app/config/watcher.py:66,74,90` — fix: use `HasField` like `get_bool` (`:82`) |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `getEnvBool` in all 3 Go services | referenced only by a `var _ = getEnvBool` suppressor or its own test; zero production call sites | `trading/internal/config/config.go:55`, `portfolio/.../config.go:195-208`, `marketdata/internal/config/config.go:201` |
| `middleware/propagation.ts` in all 4 Node services | zero importers (see doc-lie above) | `services/xstockstrat-{ledger,identity,notify,config}/src/middleware/propagation.ts` |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — The MCP agent's hardcoded `("x-access-scope","7")` self-grant is ✓ **RESOLVED** (feature 092): `_metadata()` now sends no shared-secret header at all (feature 097 removed the outbound header entirely; `services/xstockstrat-agent/app/client.py:28-30`) and write RPCs forward the *caller's derived* scope (`client.py:451,550,…`). The analysis fundsignal background loop still injects `x-access-scope=4` (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:346`), but this is now **documented as intentional** (the loop has no inbound caller to derive scope from) in the agent CLAUDE.md. Remaining question narrowed to: is the background-loop admin injection acceptable long-term? — status: **agent half resolved; loop half accepted-but-open**
- The `indicators`/`analysis`/`ingest` config watchers all subscribe to the config service under a `client_id` derived from **`"indicators-…"`** (copy-paste from the indicators template) — is the `client_id` significant to the config service's subscriber identification/dedup, or a harmless copy-paste to fix? Evidence: `analysis/app/config/watcher.py:36`, `ingest/app/config/watcher.py:38` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). These are defects to
action, not rules to keep — nothing the scan found is discarded (CF-N8). Re-run `/context-constitution` to refresh._
