# xstockstrat (root) — Constitution Findings

Defects and drift surfaced by `/context-constitution` (context-forge) on 2026-07-24 while deriving the
constitution — the things an agent trusting the docs or the surface would get **wrong**; refreshed
2026-09-02 (branch `claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`). These are for
triage/fixing (feed them to your issue tracker), not governance: a defect is not a rule. Every entry
cites the code. Refresh by re-running `/context-constitution`.

This root log holds **repo-wide / repeated** defects (the same defect in N modules is recorded once
here, not N times — per the monorepo reconciliation pass). Module-specific defects live in each
module's `context-constitution-findings.md`.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `docs/patterns/observability.md` states all services push OTLP to `otel-collector:4317` | 5 Node/Next services actually export to `:4318` (OTLP/HTTP); the split is by runtime (constitution PLAT-3) | `observability.md:5,16` vs `docker-compose.yml:127,158,190,223,489` | Correct the doc to encode the 4317-gRPC / 4318-HTTP split |
| ~~Root `CLAUDE.md` §Header Propagation vs the leaf `propagation.ts`~~ **RESOLVED (feature 175)**: all four leaf `src/middleware/propagation.ts` (ledger/notify/config **and** identity) were deleted — they had zero importers. identity's outbound admin-audit gRPC calls forward the trio via `ledgerAudit.ts`'s own `PROPAGATED_HEADERS` const over gRPC `Metadata`, never the HTTP-edge `propagation.ts`. | resolved | `services/xstockstrat-identity/src/grpc/ledgerAudit.ts` (live, own const) | n/a — the dead modules are gone; root `CLAUDE.md` §Header Propagation updated by feature 175 |
| All 3 Go service CLAUDE.md files say **"Go 1.22"** | `go.mod` is `go 1.25.0`, Dockerfiles `FROM golang:1.25-alpine`, root table pins Go 1.25 | `services/xstockstrat-{trading,portfolio,marketdata}/CLAUDE.md` "Go 1.22" vs each `go.mod:3` | ✓ **RESOLVED** (2026-08-02; re-grounded 2026-08-27) — all three service CLAUDE.md now read "Go 1.27" (`go.mod:3` = `go 1.27.0`, root table pins Go 1.27) |
| notify/identity/indicators/ingest CLAUDE.md list a **ledger/notify gRPC dependency** + "Ledger Events Emitted" tables + `LEDGER_ENDPOINT`/`NOTIFY_ENDPOINT` env vars | No ledger/notify client code exists in any of them; the env vars are read by no code; events are only `log.info` lines (or nothing) | notify/identity/indicators `CLAUDE.md` deps tables (grep-zero in `src/`/`app/`); ingest `CLAUDE.md` "Ledger Events Emitted" | ✓ **RESOLVED** (2026-08-02; re-grounded 2026-08-27) — identity/notify/indicators dropped the fictional deps; ingest now genuinely emits (`ingest/app/handlers/servicer.py:274,894` ledger `AppendEvent`; `:298` notify `EmitAlert`), so its deps are real |
| `CLAUDE.md` of analysis/config/identity/indicators/ingest/ledger/marketdata/notify/portfolio/trading list `TRADING_MODE` (and root says the `trading_mode` config axis was removed by feature 147) | The `trading_mode` request scoping is **partly retained in code**: `configWatcher.ts` (config/identity/ledger/notify), `app/config/watcher.py` (analysis/indicators/ingest) and `internal/config/config.go` (marketdata/portfolio/trading) still resolve `TRADING_MODE`; the Go `Watcher`s no longer put it in the request (trading/portfolio persist `trading_mode` columns), and marketdata `main.go` still derives the Alpaca `Paper` flag from it. Docs and code disagree on whether the axis is gone. | `services/xstockstrat-ledger/src/services/configWatcher.ts#startWatch`; `services/xstockstrat-trading/internal/config/config.go#resolveTradingMode`; `services/xstockstrat-marketdata/cmd/server/main.go` (`cfg.TradingMode == "paper"`) | Decide: finish the removal (drop the env var + resolver) or document the retained legacy scoping; then fix the ten service CLAUDE.md env blocks together |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **Python config zero-trap is a consumer defect** (CF-N10): `get_int/get_str/get_float` use `v.int_val or default`, collapsing a legitimate stored `0`/`""` to the default, even though `config.ConfigValue` is a `oneof` that distinguishes 0 from unset and the Node getter (`??`) handles it correctly. | Setting any Python-consumed int/float/str key to `0`/`""` silently reverts to the coded default (e.g. `analysis.scoring.shrinkage_days=0`, chunk sizes, timeouts). Recorded as a constitution *gotcha* too (current behavior), and here as the fix. **Update (2026-08-09 refresh):** `xstockstrat-analysis` has since added a per-key opt-in fix, `get_int_present` (mirrors `get_bool`'s `HasField` pattern), used for exactly two keys (`analysis.strategy.default_exit_cooldown_days`, `analysis.opportunity.refresh_hour_utc`). **Update (2026-10-14 refresh):** `xstockstrat-ingest` has since added `get_int_present` too (used by `ingest.backfill.max_retry_attempts`, `ingest.signals.dedup_window_hours`); only `xstockstrat-indicators` has no equivalent accessor, and every other numeric/string key in all three services remains trapped. | `services/xstockstrat-indicators/app/config/watcher.py:92,101,117`; `ingest/app/config/watcher.py#get_int` (trapped except via `get_int_present`); `analysis/app/config/watcher.py:95,101,130` (trap) vs `:103-114` (`get_int_present` fix) — fix: use `HasField` like `get_bool` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| ~~`middleware/propagation.ts`~~ **RESOLVED (feature 175)**: deleted from all four leaves (ledger/notify/config/identity) — zero importers | resolved | n/a (files removed) |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — The MCP agent's hardcoded `("x-access-scope","7")` self-grant is ✓ **RESOLVED** (feature 092): `_metadata()` now sends no shared-secret header at all (feature 097 removed the outbound header entirely; `services/xstockstrat-agent/app/client.py:28-30`) and write RPCs forward the *caller's derived* scope (`client.py:451,550,…`). The analysis fundsignal background loop still injects `x-access-scope=4` (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:447-448`), but this is now **documented as intentional** (the loop has no inbound caller to derive scope from) in the agent CLAUDE.md. Remaining question narrowed to: is the background-loop admin injection acceptable long-term? — status: **agent half resolved; loop half ✓ RESOLVED by feature 224** (the injection is deleted; fundsignal calls as the SAN-bound `system` identity, `x-internal-caller: analysis-fundsignal`)
- ~~The `indicators`/`analysis`/`ingest` config watchers all subscribe under a `client_id` derived from `"indicators-…"`~~ — **RESOLVED (feature 174): cosmetic.** Recon confirmed the config service never keys on `client_id` (it is an opaque `subId` segment plus log lines; the subscriber map keys on a `Date.now()`-unique `subId`, fan-out filters on namespace+environment, `id(self)` is already unique). analysis and ingest are corrected to their own `analysis-…`/`ingest-…` prefixes (via `_build_watch_request()`); the indicators watcher's own `indicators-` prefix was already correct and is unchanged. Evidence: `analysis/app/config/watcher.py` `_build_watch_request` (was `:60`), `ingest/app/config/watcher.py` `_build_watch_request` (was `:73`) — status: **resolved**

## Resolved

| Finding | Resolved | How confirmed |
|---|---|---|
| Node service `@types/node ^20` pin (was ◐ PARTIAL) | 2026-10-14 | `@types/node` is `^24` in `services/xstockstrat-{notify,identity,ledger,config,ui}/package.json` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). These are defects to
action, not rules to keep — nothing the scan found is discarded (CF-N8). Re-run `/context-constitution` to refresh._
