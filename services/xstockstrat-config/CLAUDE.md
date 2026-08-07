# xstockstrat-config — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (DELTA carries the full namespace + wholesale replace, defaults from call-site not DB `default_value`, enum→scope-string maps, pg_notify env+mode requirement) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (⚠ camelCase/snake_case trading-mode scoping collapse, audit-on-UPDATE-only) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Node.js gRPC service that is the **central configuration authority** for the entire platform. Provides a `WatchConfig` server-streaming RPC that all services subscribe to at startup. Config changes propagate live to all subscribers via the persistent gRPC stream. Config values are scoped by **environment** (`dev`/`production`) and **trading_mode** (`paper`/`live`/`all`).

## Language

Node.js 22 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Port | Protocol | Usage |
|---|---|---|
| `50060` | gRPC (HTTP/2) | Internal WatchConfig stream + all config reads/writes |

This service is **gRPC-only**. config-ui reaches it over gRPC `50060` (`app/lib/connectClients.ts`).
The former Connect-RPC HTTP server on `8060` (and the `src/connect/` Connect router) was removed.
Because there is no longer a separate HTTP port to gate, the gRPC server simply binds `50060` at
startup; the Docker healthcheck probes `50060` directly.

## Critical Invariants

1. **This service does NOT subscribe to itself** — it is the config source.
2. **All other services must call WatchConfig at startup** and block until they receive the initial SNAPSHOT before accepting traffic. They must pass `environment` and `trading_mode` in the request.
3. **Config values are scoped** by `environment` (`dev`/`production`) and `trading_mode` (`paper`/`live`/`all`). Rows with `trading_mode='all'` apply to both paper and live.
4. **Config changes trigger pg_notify** → reloads namespace in memory → broadcasts DELTA to all active WatchConfig subscribers (same env/mode scope).
5. **`SetConfig` is admin-gated; reads are not.** `SetConfig` rejects `PERMISSION_DENIED` ("admin scope required") unless the propagated `x-access-scope` carries the ADMIN bit (`0x04`), and rejects `INVALID_ARGUMENT` when a write has neither an explicit `author` nor a propagated `x-user-id`. Gate + helpers: `src/grpc/authz.ts` (feature 074 — the platform's first Node-side role check). `GetConfig`/`ListKeys`/`WatchConfig` are deliberately **open**: every service boots by subscribing to `WatchConfig` unauthenticated, and its first message is a full namespace snapshot, so gating reads would break platform startup without hiding anything `WatchConfig` doesn't already serve.
6. **Secrets** use `is_secret = true`. The value_data for secrets is a secret reference key (e.g. `secret://vault/alpaca-key`), not the actual value.
7. **`SetConfig` also accepts an internal-caller write, additive to the admin-scope gate** (feature
   102): a background/automated process (e.g. `xstockstrat-trading`'s reconciliation poller) may
   write a normally human-operator-gated key by propagating `x-internal-caller`
   (`HEADER_INTERNAL_CALLER`, `src/grpc/authz.ts`) instead of `x-access-scope`. This is a **structurally separate**
   metadata channel — never an extension of `x-access-scope`'s human-role bitmap — checked against
   a hardcoded `INTERNAL_CALLER_ALLOWLIST` of `{callerID, namespace, key, allowedTargetValues}`
   grants. Fails closed (an absent header, an unlisted `callerID`, or a `targetValue` outside that
   caller's allowed set are all denied) and is **direction-restricted per grant** — e.g.
   `trading-reconciliation-poller` may only write `platform.trading_state` to `REDUCE_ONLY`/
   `HALTED`, never back to `ACTIVE`, so a bug or compromised caller cannot silently clear a
   human-set halt. Every internal-caller write also persists `caller_identity` (the propagated
   `x-internal-caller` value) on both `config.config_values` and `config.config_audit` — `NULL` for
   every ordinary human/admin write — so an investigator can `WHERE`-filter "an automated process
   wrote this" instead of grepping free-text `author`/`reason` (see the Author-sentinel conventions
   table in `docs/patterns/config-governance.md`).

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| TimescaleDB/PostgreSQL | DB (schema: `config`) | Config store + audit log |

## WatchConfig Flow

```text
Service startup
  └── ConfigWatcher.WaitForSnapshot()
        └── gRPC WatchConfig(namespace="<service>") → streams ConfigSnapshot
              ├── First message: update_type=SNAPSHOT (full config dump)
              └── Subsequent messages: update_type=DELTA (carries the FULL namespace — `changedKeys=Object.keys(values)` — a wholesale replace, not just changed keys)

Config change (via SetConfig RPC)
  └── existence gate (feature 091): a write to an unregistered (namespace,key,environment,
        trading_mode) scope is refused NOT_FOUND unless the request sets create_key=true
  └── INSERT/UPDATE config.config_values
        └── audit trigger fires → config.config_audit row written
              ├── UPDATE: config_value_audit (BEFORE UPDATE, on a value change) — old→new
              └── CREATE: config_value_audit_insert (AFTER INSERT, migration 010, feature 091)
                    — one row with author + value, old_value NULL
        └── pg_notify('config_changed', {namespace, key, environment, trading_mode})
              └── ConfigServiceImpl receives LISTEN notification
                    └── Reloads namespace from DB
                          └── Broadcasts DELTA to all WatchConfig subscribers
```

## Config Keys Managed

See `migrations/001_config_tables.up.sql` for the canonical seed list and full platform config schema.

## Webhooks

_No webhooks. Mutate config via the `SetConfig` gRPC RPC on port 50060 — which requires the ADMIN scope bit and an attributable author (see Critical Invariants #5)._

## Config Governance

All config changes must comply with the governance rules in the root `CLAUDE.md`. Key rules:

- New keys require PR to `packages/proto/` (for type documentation)
- Sensitive keys (`is_secret=true`) values are never stored as plaintext
- All changes are written to `config.config_audit` automatically

## Environment Variables

```text
GRPC_PORT=50060
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development  # development | production — default scope for this instance
TRADING_MODE=paper   # paper | live — default scope for this instance
```

## Running Locally

```bash
pnpm install
# schema: run ../../scripts/db-migrate.sh from repo root (golang-migrate, not node-pg-migrate)
pnpm run dev
```
