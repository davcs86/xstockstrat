# xstockstrat-config-ui — CLAUDE.md

## Role
Next.js 14 web UI for managing runtime configuration values across the xstockstrat platform. Allows operators to view, edit, and audit config keys scoped by environment (dev/production) and trading mode (paper/live). Communicates with `xstockstrat-config` via Connect-RPC on port 8060.

## Language
TypeScript / Next.js 14 (App Router)

## Dev Port
`3002`

## Architecture

```
Browser (React Client Components)
  └── /api/config → Next.js Route Handler
        └── Connect-RPC → xstockstrat-config:8060
              └── ListKeys, SetConfig RPCs
  └── /api/audit → Next.js Route Handler
        └── Direct DB query → config.config_audit table
```

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
| xstockstrat-config | Connect-RPC HTTP (port 8060) | ListKeys, SetConfig RPCs |
| TimescaleDB/PostgreSQL | Direct DB (schema: `config`) | Read config.config_audit for audit log |

## Environment Variables

```
CONFIG_ENDPOINT=http://xstockstrat-config:8060    # Connect-RPC HTTP port (not gRPC)
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
APP_ENV=dev
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
