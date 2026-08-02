# xstockstrat-config — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the config service (the `WatchConfig` stream producer every service blocks on at startup,
gRPC 50060). Does not restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-config**.

## Rules (`CONFIG-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **CONFIG-1** | **A "DELTA" broadcast carries the ENTIRE namespace, not just changed keys** (`changedKeys = Object.keys(values)`, all of them); the consumer replaces its snapshot **wholesale**, never merges. | Emitting a true partial delta (changed keys only) would make the consumer silently drop every unchanged key on the wholesale replace. The full-namespace-per-DELTA is load-bearing. | producer `src/grpc/configServiceImpl.ts:178-200` (`reloadNamespace`, `changedKeys = Object.keys(values)` `:196`); consumer `src/services/configWatcher.ts:50-58` | `src/grpc/configServiceImpl.ts:178-200` |
| **CONFIG-2** | **Runtime defaults come from the reading code's literal, never the DB `default_value` column** (`buildConfigValue` reads only `value_data`; `default_value` is ListKeys metadata only). | An agent assuming an unset key resolves to the DB `default_value` is wrong — it resolves to whatever literal the reader passes. (Root PLAT-6.) | `configServiceImpl.ts:408-420` (`buildConfigValue`); `configWatcher.ts:84-100` | `src/grpc/configServiceImpl.ts:408-420` |
| **CONFIG-3** | **Proto enum wire numbers are hand-mapped to DB scope strings** (`ENV_MAP={0:'dev',1:'dev',2:'production'}`, `MODE_MAP={0:'all',1:'paper',2:'live'}`). | Renumbering a proto enum without updating both maps silently mis-scopes config. | `configServiceImpl.ts:19-20` (`ENV_MAP`/`MODE_MAP`), consumed via `resolveEnv:84`/`resolveMode:90` | `src/grpc/configServiceImpl.ts:19-20` |
| **CONFIG-4** | **The `pg_notify` payload must carry `environment` + `trading_mode`** — the LISTEN handler defaults missing fields to `'dev'`/`'all'`, so a notifier that omits them reloads the wrong scope bucket. | Any writer (or DB trigger) firing `config_changed` with only `{namespace,key}` silently reloads the `dev`/`all` bucket regardless of the row's real scope. | producer `configServiceImpl.ts:348-350` (`pg_notify`); LISTEN handler `:134-142` | `src/grpc/configServiceImpl.ts:348-350` |
| **CONFIG-5** | **Request enum fields arrive as ts-proto `stringEnums` string constants (`'ENVIRONMENT_PRODUCTION'`) with camelCase names (`tradingMode`), so `resolveEnv`/`resolveMode`/`requestMode` MUST accept the string/camelCase form** — a numeric-`*_MAP`-only lookup collapses every request to `('dev','all')`. | `packages/proto/buf.gen.yaml` sets `stringEnums=true`, so a decoded request carries the string constant, not the wire int; the fixed SEV-1 scope-collapse (findings) was exactly a numeric-only lookup. | `configServiceImpl.ts:84-97` (`resolveEnv`/`resolveMode` accept string+number), `requestMode:100`, contract comment `:75-76`; call sites `:228-229,268` | `src/grpc/configServiceImpl.ts:84-102` |

## Gotchas & scars

- **Node `getInt` does NOT have the Python zero-trap** — it uses `v?.intVal ?? def`, so a stored `0` returns `0`, and the producer round-trips `0` cleanly. The "0 reads as default" behavior documented in root CLAUDE.md is a **Python** property, not a Node one. An agent copying "0 means default" into Node code is wrong. Evidence: `src/services/configWatcher.ts:88-91`, `configServiceImpl.ts:408-420` (`buildConfigValue`). (Confirms root PLAT-6 gotcha + CF-N10.)
- **Snapshot values are encoded camelCase for ts-proto** (`string_val→stringVal`, `trading_mode→tradingMode`); consumers read camelCase. This is the contract that makes the request-decode bug (findings) detectable. Evidence: `configServiceImpl.ts:25-37` (camelCase snapshot encode), `:65` (`changedKeys` read).

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| `waitForSnapshot` default is 10s while root docs cite a 90s config-startup timeout — may be two timers or a conflict | `configWatcher.ts:71` (10s) vs `docs/patterns/config-startup.md` (90s) | read `config-startup.md` to distinguish snapshot-wait from healthcheck-wait |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Pool cap 2; one conn permanently dedicated to `LISTEN config_changed` | `src/index.ts:30-34`, `configServiceImpl.ts:134-142` (LISTEN handler); root pool budget |
| `is_secret=true` rows store a reference key, never plaintext (pass-through, never resolved/masked) | `CLAUDE.md:32`, `configServiceImpl.ts:408-420` |
| `trading_mode='all'` rows fan into paper+live+all buckets | `CLAUDE.md:30`, `configServiceImpl.ts:122` |
| Migration NNN ≠ feature NNN | `migrations/007_marketdata_fmp.up.sql:6` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
