# xstockstrat-config-ui — CLAUDE.md

## Role
Next.js 15 web UI for managing runtime configuration values across the xstockstrat platform. Allows operators to view, edit, and audit config keys scoped by environment (dev/production) and trading mode (paper/live). Communicates with `xstockstrat-config` via gRPC (H2C) on port 50060.

## Language
TypeScript / Next.js 15 (App Router)

## Docker Build Pattern
Frontend pattern — see `docs/patterns/docker-build.md` for the base + deps + builder + runner stages, `--filter` usage, and `.next/standalone` optimization.

## Dev Port
`3002`

## Architecture

```
Browser (React Client Components)
  └── TanStack Query typed hooks (app/hooks/) → browserClients.ts (connect-web)
        └── Connect BFF  /config-ui/api/[...connect]  (connectBff.ts)
              ├── gRPC (H2C) → xstockstrat-config:50060  (ListKeys, SetConfig)
              └── gRPC (H2C) → xstockstrat-ingest:50055  (ListSignalSources, ManageSignalSource)
  └── app/api/audit → Next.js Route Handler
        └── Direct DB query → config.config_audit table
```

## Client Hooks

All client-side data access goes through named typed hooks in `app/hooks/`:

| Hook file | Exported hooks | Query key |
|---|---|---|
| `useConfigKeys.ts` | `useConfigKeys` | `['config-keys', namespace, env, mode]` |
| `useSetConfig.ts` | `useSetConfig` | mutation |
| `useAuditLog.ts` | `useAuditLog` | `['audit-log']` |
| `useSignalSources.ts` | `useSignalSources` | `['signal-sources']` |
| `useSignalSourceMutations.ts` | `useManageSignalSource` | mutation |

Provider: `app/lib/queryClient.ts` + `app/providers.tsx`. Note: config-ui has flat layout (no `src/`); `@/*` maps to `./*`.

## Key Pages

| Route | Description |
|---|---|
| `/` | Namespace list dashboard with environment + mode switcher |
| `/[namespace]?env=dev&mode=paper` | Config key-value table for a namespace |
| `/audit` | Audit log — all recent config changes |

## Environment & Trading Mode Scoping

All pages support `?env=dev|production&mode=paper|live` query parameters.
These are passed to the `ListKeys` and `SetConfig` RPCs as `environment` and `trading_mode` fields.
The config service returns values appropriate for the selected scope.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC `50060` | ListKeys, SetConfig RPCs |
| xstockstrat-identity | gRPC `50058` | Token validation |
| xstockstrat-ingest | gRPC `50055` | Signal data queries |
| TimescaleDB/PostgreSQL | Direct DB (schema: `config`) | Read config.config_audit for audit log |

## Environment Variables

```
# gRPC endpoints (host:port, no protocol) — consumed by server-side route handlers only
CONFIG_ENDPOINT=xstockstrat-config:50060
IDENTITY_ENDPOINT=xstockstrat-identity:50058
INGEST_ENDPOINT=xstockstrat-ingest:50055
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development            # .env.local
TRADING_MODE=paper
```

## Running Locally

```bash
pnpm install
pnpm run dev
```

## Notes

- This service does NOT subscribe to xstockstrat-config via WatchConfig — it is a management UI, not a service consumer.
- Secret values (`is_secret=true`) are displayed as `[secret]` and cannot be edited via the UI.
- All edits are written via `SetConfig` RPC with `author=config-ui` and a reason string.
