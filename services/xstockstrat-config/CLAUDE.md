# xstockstrat-config — CLAUDE.md

## Role
Node.js gRPC service that is the **central configuration authority** for the entire platform. Provides a `WatchConfig` server-streaming RPC that all services subscribe to at startup. Config changes propagate live to all subscribers via the persistent gRPC stream. Config values are scoped by **environment** (`dev`/`production`) and **trading_mode** (`paper`/`live`/`all`).

## Language
Node.js 20 + TypeScript

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
5. **Secrets** use `is_secret = true`. The value_data for secrets is a secret reference key (e.g. `secret://vault/alpaca-key`), not the actual value.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| TimescaleDB/PostgreSQL | DB (schema: `config`) | Config store + audit log |

## WatchConfig Flow

```
Service startup
  └── ConfigWatcher.WaitForSnapshot()
        └── gRPC WatchConfig(namespace="<service>") → streams ConfigSnapshot
              ├── First message: update_type=SNAPSHOT (full config dump)
              └── Subsequent messages: update_type=DELTA (changed keys only)

Config change (via SetConfig RPC)
  └── INSERT/UPDATE config.config_values
        └── audit trigger fires → config.config_audit row written
        └── pg_notify('config_changed', {namespace, key})
              └── ConfigServiceImpl receives LISTEN notification
                    └── Reloads namespace from DB
                          └── Broadcasts DELTA to all WatchConfig subscribers
```

## Config Keys Managed

See `migrations/001_config_tables.up.sql` for the canonical seed list and full platform config schema.

## Webhooks

_No webhooks. Mutate config via the `SetConfig` gRPC RPC on port 50060._

## Config Governance

All config changes must comply with the governance rules in the root `CLAUDE.md`. Key rules:
- New keys require PR to `packages/proto/` (for type documentation)
- Sensitive keys (`is_secret=true`) values are never stored as plaintext
- All changes are written to `config.config_audit` automatically

## Environment Variables

```
GRPC_PORT=50060
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development  # development | production — default scope for this instance
TRADING_MODE=paper   # paper | live — default scope for this instance
```

## Running Locally

```bash
pnpm install
pnpm run migrate
pnpm run dev
```
