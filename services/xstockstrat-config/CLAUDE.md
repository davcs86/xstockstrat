# xstockstrat-config — CLAUDE.md

## Role
Node.js gRPC + Connect-RPC service that is the **central configuration authority** for the entire platform. Provides a `WatchConfig` server-streaming RPC that all services subscribe to at startup. Config changes propagate live to all subscribers via the persistent gRPC stream. Config values are scoped by **environment** (`dev`/`production`) and **trading_mode** (`paper`/`live`/`all`).

## Language
Node.js 20 + TypeScript

## Ports

| Port | Protocol | Usage |
|---|---|---|
| `50060` | gRPC (HTTP/2) | Internal service-to-service WatchConfig stream |
| `8060` | Connect-RPC (HTTP/1.1 + HTTP/2) | Browser clients, config-ui, n8n webhooks |

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

Config change (via SetConfig RPC or n8n webhook)
  └── INSERT/UPDATE config.config_values
        └── audit trigger fires → config.config_audit row written
        └── pg_notify('config_changed', {namespace, key})
              └── ConfigServiceImpl receives LISTEN notification
                    └── Reloads namespace from DB
                          └── Broadcasts DELTA to all WatchConfig subscribers
```

## Config Keys Managed

See `migrations/001_config_tables.up.sql` for the canonical seed list and full platform config schema.

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/set-config` | POST | `{namespace, key, value, author, reason}` | Updates a config value |
| `/webhooks/n8n/list-keys` | POST | `{namespace}` | Lists all keys for namespace |
| `/webhooks/n8n/rollout` | POST | `{changes: [{namespace, key, value}], author, reason}` | Atomic multi-key rollout |

## Config Governance

All config changes via n8n must comply with the governance rules in the root `CLAUDE.md`. Key rules:
- New keys require PR to `packages/proto/` (for type documentation)
- Sensitive keys (`is_secret=true`) values are never stored as plaintext
- All changes are written to `config.config_audit` automatically

## Environment Variables

```
GRPC_PORT=50060
HTTP_PORT=8060
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
APP_ENV=dev          # dev | production — default scope for this instance
TRADING_MODE=paper   # paper | live — default scope for this instance
```

## Running Locally

```bash
pnpm install
pnpm run migrate
pnpm run dev
```
