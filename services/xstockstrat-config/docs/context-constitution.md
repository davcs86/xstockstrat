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
| **CONFIG-2** | **Runtime defaults come from the reading code's literal, never the DB `default_value` column** (`buildConfigValue` reads only `value_data`; `default_value` is ListKeys metadata only). | An agent assuming an unset key resolves to the DB `default_value` is wrong — it resolves to whatever literal the reader passes. (Root PLAT-6.) | `configServiceImpl.ts:457-469` (`buildConfigValue`); `configWatcher.ts:84-100` | `src/grpc/configServiceImpl.ts:457-469` |
| **CONFIG-3** | **Proto enum wire numbers are hand-mapped to DB scope strings** (`ENV_MAP={0:'dev',1:'dev',2:'production'}`, `MODE_MAP={0:'all',1:'paper',2:'live'}`). | Renumbering a proto enum without updating both maps silently mis-scopes config. | `configServiceImpl.ts:19-20` (`ENV_MAP`/`MODE_MAP`), consumed via `resolveEnv:84`/`resolveMode:90` | `src/grpc/configServiceImpl.ts:19-20` |
| **CONFIG-4** | **The `pg_notify` payload must carry `environment` + `trading_mode`** — the LISTEN handler defaults missing fields to `'dev'`/`'all'`, so a notifier that omits them reloads the wrong scope bucket. | Any writer (or DB trigger) firing `config_changed` with only `{namespace,key}` silently reloads the `dev`/`all` bucket regardless of the row's real scope. | producer `configServiceImpl.ts:380-382` (`pg_notify`); LISTEN handler `:134-142` | `src/grpc/configServiceImpl.ts:380-382` |
| **CONFIG-5** | **Request enum fields arrive as ts-proto `stringEnums` string constants (`'ENVIRONMENT_PRODUCTION'`) with camelCase names (`tradingMode`), so `resolveEnv`/`resolveMode`/`requestMode` MUST accept the string/camelCase form** — a numeric-`*_MAP`-only lookup collapses every request to `('dev','all')`. | `packages/proto/buf.gen.yaml` sets `stringEnums=true`, so a decoded request carries the string constant, not the wire int; the fixed SEV-1 scope-collapse (findings) was exactly a numeric-only lookup. | `configServiceImpl.ts:84-97` (`resolveEnv`/`resolveMode` accept string+number), `requestMode:100`, contract comment `:75-76`; call sites `:228-229,268` | `src/grpc/configServiceImpl.ts:84-102` |
| **CONFIG-6** | **`SetConfig`'s existence-gate lookup is deliberately exact-scope** (`environment = $2 AND trading_mode = $3`, no `OR trading_mode = 'all'`) — never broaden it to match the read paths' `(mode OR 'all')` pattern. | Broadening the gate would let a per-mode write "find" an existing `'all'`-scoped row via the gate check yet still INSERT a *new*, distinct mode-exact row — silently forking one logical key into two rows with a nondeterministic read order. This inverts the read-path convention on purpose. | `configServiceImpl.ts:350` (comment) + exact-match `SELECT`; tested `src/__tests__/setConfigAuthz.test.ts:191-220` | `src/grpc/configServiceImpl.ts:350` |
| **CONFIG-7** | **`ListKeys` de-dupes a key when both a `trading_mode='all'` row and a mode-exact shadow row exist for the same `(namespace,key,environment)`, always preferring the mode-exact row** — and a caller must echo back *that returned row's own* `(environment, trading_mode)` on a subsequent `SetConfig`, never the scope it was viewing under, or the write trips CONFIG-6's gate. | This is exactly the bug fixed in `#884` — Save on the displayed `'all'` row silently failed because config-ui sent its viewed filter's scope instead of the row's own registered scope. | `configServiceImpl.ts:400-410` (dedup + comment); tested `src/__tests__/listKeysDedup.test.ts` | `src/grpc/configServiceImpl.ts:400-410` |
| **CONFIG-8** | **`platform.trading_state` is deliberately seeded per-`trading_mode` (`paper`/`live` separately), not `'all'` like most keys** — so halting live trading during an incident doesn't also halt paper testing. Write-time validation restricts it to a hardcoded 3-literal allowlist (`ACTIVE`/`REDUCE_ONLY`/`HALTED`), a deliberate deferral rather than a proto enum. | Looks like a schema inconsistency (every other key uses `'all'`) but is intentional — don't "fix" it to `'all'` seeding. | seed `migrations/011_platform_trading_state.up.sql:4-6,9-18` (4 rows, no `'all'`); validation `configServiceImpl.ts:330-344` | `services/xstockstrat-config/migrations/011_platform_trading_state.up.sql:9-18` |

## Gotchas & scars

- **Node `getInt` does NOT have the Python zero-trap** — it uses `v?.intVal ?? def`, so a stored `0` returns `0`, and the producer round-trips `0` cleanly. The "0 reads as default" behavior documented in root CLAUDE.md is a **Python** property, not a Node one. An agent copying "0 means default" into Node code is wrong. Evidence: `src/services/configWatcher.ts:88-91`, `configServiceImpl.ts:457-469` (`buildConfigValue`). (Confirms root PLAT-6 gotcha + CF-N10.)
- **Snapshot values are encoded camelCase for ts-proto** (`string_val→stringVal`, `trading_mode→tradingMode`); consumers read camelCase. This is the contract that makes the request-decode bug (findings) detectable. Evidence: `configServiceImpl.ts:25-37` (camelCase snapshot encode), `:65` (`changedKeys` read).
- **`x-internal-caller` is a second, structurally separate authz channel from `x-access-scope`** (root PLAT-9) — a hardcoded per-`{callerID, namespace, key}` allowlist, direction-restricted (e.g. the trading reconciliation poller may only move `platform.trading_state` toward `REDUCE_ONLY`/`HALTED`, never back to `ACTIVE`), fails closed, and persists the caller id in a dedicated `caller_identity` column (`NULL` for ordinary human writes) rather than free-text `author`/`reason`. Already documented in this service's own CLAUDE.md item 7; recorded here because feature 102 postdates this constitution's original derivation and had zero `CONFIG-*` coverage until this refresh. Evidence: `src/grpc/authz.ts:71-135` (`HEADER_INTERNAL_CALLER`, `INTERNAL_CALLER_ALLOWLIST`, `hasInternalCallerAuthority`); `configServiceImpl.ts:301-315` (consumption); `migrations/014_config_caller_identity.up.sql:1-9` (column).
- **`#884` — `ListKeys` dedup + own-scope echo (see CONFIG-6/CONFIG-7).** Two-part production bug: a key with both an `'all'` row and a mode-exact shadow row showed up twice, and Save on the `'all'` row was silently refused because config-ui sent its *viewed filter's* scope instead of the row's own registered scope. Fixed by the dedup logic + config-ui echoing the row's actual scope.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| `waitForSnapshot` default is 10s while root docs cite a 90s config-startup timeout — may be two timers or a conflict | `configWatcher.ts:71` (10s) vs `docs/patterns/config-startup.md` (90s) | read `config-startup.md` to distinguish snapshot-wait from healthcheck-wait |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Pool cap 2; one conn permanently dedicated to `LISTEN config_changed` | `src/index.ts:30-34`, `configServiceImpl.ts:134-142` (LISTEN handler); root pool budget |
| `is_secret=true` rows store a reference key, never plaintext (pass-through, never resolved/masked) | `CLAUDE.md:37`, `configServiceImpl.ts:457-469` |
| `trading_mode='all'` rows fan into paper+live+all buckets | `CLAUDE.md:34`, `configServiceImpl.ts:155-163,186` |
| Migration NNN ≠ feature NNN | `migrations/007_marketdata_fmp.up.sql:6` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
